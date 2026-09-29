/*
 * NJP CALL — page d'accueil du configurateur.
 *
 * Aucune affirmation non démontrée : pas de taux de résolution, pas de
 * durée de mise en service, pas de conformité déclarée. Ce que l'outil fait,
 * ce qui reste simulé, et où vit le vrai produit.
 */
import { Link } from "wouter";
import { Settings, MessageSquare, FileText, ShieldCheck } from "lucide-react";

const blocks = [
  {
    icon: Settings,
    title: "Configurer",
    text: "Nom de l'assistante, accueil, horaires, praticiens, types de rendez-vous, consigne d'urgence à valider, conservation. Réglages publics uniquement : aucun secret n'est saisi ici.",
    href: "/config",
  },
  {
    icon: MessageSquare,
    title: "Recetter",
    text: "Simuler un appel au clavier avec le vrai moteur de conversation. Rien n'est envoyé au cabinet : chaque opération porte le statut « simulé ».",
    href: "/simulation",
  },
  {
    icon: FileText,
    title: "Relire",
    text: "Comptes rendus administratifs des appels de recette : ce qui a été demandé, ce qui a (ou n'a pas) été exécuté.",
    href: "/historique",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <section className="border-b-[3px] border-foreground">
        <div className="container py-12 lg:py-16 max-w-4xl">
          <p className="text-sm font-heading font-semibold uppercase tracking-wide text-muted-foreground mb-3">Extension NJP CARE — by NJP CARE</p>
          <h1 className="text-4xl lg:text-5xl font-bold mb-5">NJP CALL, la secrétaire vocale automatisée du cabinet</h1>
          <p className="text-lg text-muted-foreground mb-4">
            NJP CALL répond aux appels, s'annonce comme assistante automatisée, prend les messages, les demandes de rappel et les
            demandes de rendez-vous, et les enregistre dans NJP CARE. Elle s'installe depuis le <strong>NJP CARE STORE</strong> et
            apparaît dans le logiciel comme l'espace « Secrétariat ».
          </p>
          <p className="text-muted-foreground">
            Cette page est l'outil de <strong>configuration et de recette</strong>. Elle ne remplace pas NJP CARE et ne décroche aucun
            appel réel.
          </p>
        </div>
      </section>

      <section className="container py-10 grid gap-6 md:grid-cols-3">
        {blocks.map(({ icon: Icon, title, text, href }) => (
          <Link key={href} href={href} className="block no-underline border-[3px] border-foreground bg-card p-6 shadow-[4px_4px_0px] shadow-foreground hover:-translate-y-0.5 transition-transform">
            <Icon className="w-6 h-6 mb-3 text-primary" />
            <h2 className="text-xl font-bold mb-2 text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">{text}</p>
          </Link>
        ))}
      </section>

      <section className="container pb-14 max-w-4xl">
        <div className="border-[3px] border-foreground p-6 bg-secondary/30">
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Ce qui est vrai aujourd'hui
          </h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li>Le moteur de conversation, de règles et de session est implémenté et éprouvé par des tests automatisés.</li>
            <li>Dans NJP CARE, l'écriture réelle des messages, demandes de rappel et rendez-vous passe par le moteur du logiciel, après installation et activation de l'extension.</li>
            <li>Aucun fournisseur téléphonique ni fournisseur d'IA n'est encore retenu : leur choix dépend de vérifications contractuelles, géographiques et de protection des données.</li>
            <li>Aucune conformité réglementaire n'est déclarée : l'analyse (RGPD, HDS, information sur l'IA) est documentée et reste à valider.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
