/**
 * Metros are CONFIG, not code (Part 4.5). Wave three = add a block here.
 * Term lists are the blueprint's Part 4.5 starter set, verbatim.
 */

export const METRO_TERMS = {
  nyc: [
    'NYC', 'New York', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Jersey City',
    'Hoboken', 'Long Island', 'Westchester',
  ],
  sofla: [
    'Miami', 'Fort Lauderdale', 'Boca Raton', 'West Palm Beach', 'Palm Beach',
    'Delray', 'Wynwood', 'Brickell', 'South Florida',
  ],
} as const

/** Display labels for the metro enum (Part III). */
export const METRO_LABELS = {
  nyc: 'NYC',
  sofla: 'SoFla',
  other: 'Other',
  unknown: 'Unknown',
} as const
