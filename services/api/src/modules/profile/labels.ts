// Etichette italiane per le chiavi del profilo che non sono temi dei puzzle.

const LABELS: Record<string, Record<string, string>> = {
  structure: {
    iqp: 'Pedone isolato di donna (IQP)',
    carlsbad: 'Struttura Carlsbad',
    maroczy: 'Maroczy bind',
    hanging_pawns: 'Pedoni sospesi',
    stonewall: 'Stonewall',
    french: 'Catena francese',
    kings_indian: 'Catena Est-Indiana',
    open_center: 'Centro aperto',
    closed_center: 'Centro chiuso',
  },
  endgame_type: {
    pawn: 'Finale di pedoni',
    rook: 'Finale di torre',
    rook_pawn: 'Torre e pedone contro torre',
    minor: 'Finale di pezzi minori',
    queen: 'Finale di donna',
    mixed: 'Finale misto',
  },
  mistake: {
    missed_tactic: 'Tattica mancata',
    hanging_piece: 'Pezzo lasciato in presa',
    missed_mate: 'Matto mancato',
    allowed_tactic: 'Tattica concessa',
    endgame_technique: 'Tecnica di finale',
    positional: 'Errore posizionale',
    opening_deviation: "Uscita dal libro d'apertura",
  },
  opening: {},
};

export function labelFor(dimension: string, key: string): string {
  return LABELS[dimension]?.[key] ?? key;
}
