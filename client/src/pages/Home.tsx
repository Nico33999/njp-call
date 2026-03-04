/*
 * Design: Signal — Néo-Brutaliste Télécom
 * Page d'accueil avec hero section, features, et CTA
 * Couleurs franches, bordures épaisses, ombres décalées
 */
import { Link } from "wouter";
import { Phone, Settings, MessageSquare, BarChart3, Shield, Clock, Zap, Users } from "lucide-react";
import { motion } from "framer-motion";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663392666558/aVBEyTu9zJPXVXR49mAvhc/hero-bg-PM32B92BQ6AwE7pwGPZLkW.webp";
const CONFIG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663392666558/aVBEyTu9zJPXVXR49mAvhc/config-illustration-h3MDMFB7uzzYnqhdEcgfFJ.webp";
const PHONE_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663392666558/aVBEyTu9zJPXVXR49mAvhc/phone-simulation-B7t4A35aFRjxeYsmdjYgc2.webp";

const features = [
  {
    icon: Settings,
    title: "Configuration complète",
    desc: "Personnalisez le nom, le ton, les horaires, les services et les intégrations de votre assistant.",
    color: "bg-primary",
  },
  {
    icon: MessageSquare,
    title: "Simulation en direct",
    desc: "Testez votre assistant dans une interface de chat simulant un vrai appel téléphonique.",
    color: "bg-accent",
  },
  {
    icon: BarChart3,
    title: "Historique des appels",
    desc: "Consultez le récapitulatif structuré de chaque appel simulé avec les actions effectuées.",
    color: "bg-emerald",
  },
  {
    icon: Shield,
    title: "Conforme RGPD",
    desc: "Collecte minimale, pas de données sensibles, gestion des demandes de suppression.",
    color: "bg-primary",
  },
];

const stats = [
  { icon: Clock, value: "< 60s", label: "Résolution moyenne" },
  { icon: Zap, value: "90%", label: "Taux de résolution" },
  { icon: Users, value: "5+", label: "Services gérés" },
  { icon: Phone, value: "24/7", label: "Disponibilité" },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b-[3px] border-foreground">
        <div className="container py-16 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Text */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="badge-online inline-block mb-6">En ligne</div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] mb-6 text-foreground">
                Votre accueil
                <br />
                téléphonique,
                <br />
                <span className="text-primary">automatisé.</span>
              </h1>
              <p className="text-lg text-muted-foreground mb-8 max-w-lg leading-relaxed">
                Configurez un assistant IA qui répond comme une vraie secrétaire : naturel, rapide, professionnel. Transferts, prises de messages, rendez-vous — tout en moins de 60 secondes.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/config"
                  className="brutal-btn inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 text-base no-underline"
                >
                  <Settings className="w-5 h-5" />
                  Configurer l'assistant
                </Link>
                <Link
                  href="/simulation"
                  className="brutal-btn inline-flex items-center gap-2 bg-card text-foreground px-6 py-3 text-base no-underline"
                >
                  <Phone className="w-5 h-5" />
                  Tester la simulation
                </Link>
              </div>
            </motion.div>

            {/* Right: Hero Image */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
              className="relative"
            >
              <div className="brutal-card p-2 overflow-hidden">
                <img
                  src={HERO_IMG}
                  alt="Système d'accueil téléphonique IA"
                  className="w-full h-auto object-cover border-2 border-foreground"
                  loading="eager"
                />
              </div>
              {/* Floating badge */}
              <div className="absolute -bottom-4 -left-4 brutal-card px-4 py-2 bg-emerald text-white font-heading font-semibold text-sm">
                IA Conversationnelle
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-foreground text-background border-b-[3px] border-foreground">
        <div className="container py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <Icon className="w-6 h-6 text-accent" />
                  <div>
                    <div className="font-heading text-2xl font-bold">{stat.value}</div>
                    <div className="text-sm opacity-70">{stat.label}</div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="border-b-[3px] border-foreground">
        <div className="container py-16 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-12"
          >
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">Fonctionnalités</h2>
            <p className="text-muted-foreground text-lg max-w-2xl">
              Tout ce dont vous avez besoin pour un accueil téléphonique professionnel, sans embaucher.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-6">
            {features.map((feat, i) => {
              const Icon = feat.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="brutal-card p-6"
                >
                  <div
                    className={`w-12 h-12 ${feat.color} flex items-center justify-center border-2 border-foreground shadow-[3px_3px_0px] shadow-foreground mb-4`}
                  >
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{feat.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feat.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b-[3px] border-foreground">
        <div className="container py-16 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="brutal-card p-2 overflow-hidden">
                <img
                  src={CONFIG_IMG}
                  alt="Configuration de l'assistant"
                  className="w-full h-auto object-cover border-2 border-foreground"
                />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-3xl lg:text-4xl font-bold mb-6">Comment ça marche</h2>
              <div className="space-y-6">
                {[
                  { step: "01", title: "Configurez", desc: "Renseignez le nom de votre entreprise, les services, les horaires et le ton de l'assistant." },
                  { step: "02", title: "Simulez", desc: "Testez l'assistant dans l'interface de simulation. Il détecte les intentions et agit en conséquence." },
                  { step: "03", title: "Déployez", desc: "Exportez la configuration pour l'intégrer à votre système téléphonique (OnOff, Webex, SIP)." },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-12 h-12 bg-primary text-primary-foreground flex items-center justify-center font-heading font-bold text-lg border-2 border-foreground shadow-[3px_3px_0px] shadow-foreground shrink-0">
                      {item.step}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold mb-1">{item.title}</h3>
                      <p className="text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-primary border-b-[3px] border-foreground">
        <div className="container py-16 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl lg:text-4xl font-bold text-primary-foreground mb-4">
              Prêt à automatiser votre accueil ?
            </h2>
            <p className="text-primary-foreground/80 text-lg mb-8 max-w-xl mx-auto">
              Commencez par configurer votre assistant. C'est rapide, gratuit, et sans engagement.
            </p>
            <Link
              href="/config"
              className="brutal-btn inline-flex items-center gap-2 bg-card text-foreground px-8 py-4 text-lg no-underline border-foreground"
            >
              <Settings className="w-5 h-5" />
              Commencer la configuration
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-card">
        <div className="container py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary flex items-center justify-center border-2 border-foreground">
              <Phone className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-sm">NJP Call</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Assistant d'accueil téléphonique IA — Conforme RGPD
          </p>
        </div>
      </footer>
    </div>
  );
}
