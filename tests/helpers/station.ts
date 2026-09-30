/**
 * Un poste NJP CARE de banc : il déclare son état, relève le relais à bail,
 * applique par la doublure `FakeCare` (mêmes règles que le moteur Rust) et
 * rend chaque verdict avec son bail. Il se reconnecte seul (temporisation)
 * quand le service disparaît — c'est ce que fait le travailleur du shell.
 */
import type { FakeCare } from "../../core/testing/fakeCare";

export const STATUS_OK = (
  issuedAt: string,
  over: Record<string, unknown> = {}
) => ({
  v: 1,
  extensionEnabled: true,
  permissions: [
    "planning.availability.read",
    "appointments.book",
    "secretariat.messages.create",
    "secretariat.callbacks.create",
    "appointments.requests.create",
  ],
  bookingEnabled: true,
  remindersOnDisable: "suspend",
  issuedAt,
  validForSeconds: 3600,
  ...over,
});

export class Station {
  private stopped = false;
  private loop?: Promise<void>;
  /** Nombre de verdicts rendus (accusés 204). */
  acked = 0;
  /** Relèves abouties (réponse du service reçue). */
  polls = 0;
  /** Erreurs réseau rencontrées (service absent) : preuve de la reconnexion. */
  networkErrors = 0;
  /** Panne du POSTE : applique, puis « meurt » avant de rendre le verdict (une fois). */
  crashAfterApplyOnce = false;
  status: Record<string, unknown> | null;

  constructor(
    private base: () => string,
    private readonly token: string,
    private readonly care: FakeCare,
    opts: { status?: Record<string, unknown> | null; waitMs?: number } = {}
  ) {
    this.status =
      opts.status === undefined
        ? STATUS_OK(new Date().toISOString())
        : opts.status;
    this.waitMs = opts.waitMs ?? 300;
  }
  private readonly waitMs: number;

  private headers(json = false): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  async declare(status = this.status) {
    if (!status) return 0;
    const r = await fetch(`${this.base()}/v1/care/status`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(status),
    });
    return r.status;
  }

  /** Rend un verdict, en réessayant tant que le service est absent (même bail). */
  async post(id: string, lease: string, result: unknown): Promise<number> {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(`${this.base()}/v1/care/result`, {
          method: "POST",
          headers: this.headers(true),
          body: JSON.stringify({ id, lease, result }),
        });
        if (r.status === 204) this.acked++;
        return r.status;
      } catch {
        this.networkErrors++;
        if (this.stopped || i > 200) return 0;
        await new Promise(r => setTimeout(r, Math.min(50 * 2 ** i, 500)));
      }
    }
  }

  start() {
    this.loop = (async () => {
      let backoff = 50;
      let declared = false;
      while (!this.stopped) {
        try {
          if (!declared) {
            await this.declare();
            declared = true;
          }
          const r = await fetch(
            `${this.base()}/v1/care/next?wait=${this.waitMs}`,
            { headers: this.headers() }
          );
          backoff = 50;
          this.polls++;
          if (r.status !== 200) {
            await r.arrayBuffer();
            continue;
          }
          const { item } = await r.json();
          const result =
            item.kind === "command"
              ? await this.care.send(item.envelope)
              : await this.care.findSlots(this.care.cabinetId, item.query);
          if (this.crashAfterApplyOnce) {
            this.crashAfterApplyOnce = false;
            continue; // appliqué dans le coffre, verdict jamais rendu
          }
          await this.post(item.id, item.lease, result);
        } catch {
          this.networkErrors++;
          declared = false; // service redémarré : on redéclare l'état
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 400);
        }
      }
    })();
    return this;
  }

  async stop() {
    this.stopped = true;
    await this.loop?.catch(() => undefined);
  }
}
