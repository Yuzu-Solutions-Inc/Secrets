export const missionSeeds = [
  {
    key: "forbidden-word",
    title: { en: "The forbidden word", fr: "Le mot interdit" },
    instructions: {
      en: "Make the chosen player say the host’s secret word before time runs out.",
      fr: "Fais dire le mot secret de l’animateur à la personne choisie avant la fin.",
    },
  },
  {
    key: "unlikely-compliment",
    title: { en: "Suspiciously kind", fr: "Étrangement gentil" },
    instructions: {
      en: "Give three sincere compliments without anyone calling out the mission.",
      fr: "Fais trois compliments sincères sans que personne ne démasque la mission.",
    },
  },
  {
    key: "object-swap",
    title: { en: "The quiet switch", fr: "L’échange discret" },
    instructions: {
      en: "Move the chosen object to three different rooms without being noticed.",
      fr: "Déplace l’objet choisi dans trois pièces sans te faire remarquer.",
    },
  },
] as const;

export const eventSeeds = [
  {
    key: "double-hints",
    title: { en: "Clue rush", fr: "Pluie d’indices" },
    body: {
      en: "Hint buzzes reveal two consecutive hints for the next ten minutes.",
      fr: "Les buzz indices révèlent deux indices pendant dix minutes.",
    },
  },
  {
    key: "silent-house",
    title: { en: "Silent house", fr: "Maison silencieuse" },
    body: {
      en: "Nobody may speak for five minutes. Secret missions remain active.",
      fr: "Personne ne peut parler pendant cinq minutes. Les missions continuent.",
    },
  },
  {
    key: "wallet-freeze",
    title: { en: "Frozen vault", fr: "Cagnotte gelée" },
    body: {
      en: "Money transfers pause until the host ends the event.",
      fr: "Les transferts sont suspendus jusqu’à la fin de l’événement.",
    },
  },
] as const;

export const powerSeeds = [
  { key: "immunity", title: { en: "Immunity", fr: "Immunité" } },
  { key: "double-vote", title: { en: "Double vote", fr: "Vote double" } },
  { key: "free-hint", title: { en: "Free hint", fr: "Indice gratuit" } },
  { key: "buzz-shield", title: { en: "Buzz shield", fr: "Bouclier anti-buzz" } },
] as const;
