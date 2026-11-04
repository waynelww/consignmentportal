// Plain Series yarn colours. A/H/C + number, e.g. A19 = yarn 19 Dark Coffee.
// The number is the yarn number; the letter is the cut and is kept separately.

export interface YarnColour {
  no: number
  name: string
  hex: string
}

export const YARN_COLOURS: YarnColour[] = [
  { no: 1, name: 'Purple Blue', hex: '#323a5a' },
  { no: 2, name: 'Light Purple Blue', hex: '#384b71' },
  { no: 3, name: 'Denim Blue', hex: '#2b3c51' },
  { no: 4, name: 'Sharp Blue', hex: '#0b5575' },
  { no: 5, name: 'Sea Blue', hex: '#0a6399' },
  { no: 6, name: 'Aqua Blue', hex: '#1c4484' },
  { no: 7, name: 'Sky Blue', hex: '#2f93ce' },
  { no: 8, name: 'Tiffany Blue', hex: '#6bc2be' },
  { no: 9, name: 'Grey Blue', hex: '#909cb1' },
  { no: 10, name: 'Neon Yellow', hex: '#dbe360' },
  { no: 11, name: 'Classic Green', hex: '#106851' },
  { no: 12, name: 'Deem Blue', hex: '#195485' },
  { no: 13, name: 'Army Green', hex: '#414a2a' },
  { no: 14, name: 'Deem Green', hex: '#1a3d45' },
  { no: 15, name: 'Desert Green', hex: '#5e5a45' },
  { no: 16, name: 'Charcoal Blue', hex: '#344057' },
  { no: 17, name: 'Light Grey', hex: '#b5afb3' },
  { no: 18, name: 'Grey Black', hex: '#212222' },
  { no: 19, name: 'Dark Coffee', hex: '#271f18' },
  { no: 20, name: 'Sand Brown', hex: '#4b3d35' },
  { no: 21, name: 'Teddy Brown', hex: '#382619' },
  { no: 22, name: 'Desert Brown', hex: '#694e41' },
  { no: 23, name: 'Pink Orange', hex: '#c0847b' },
  { no: 24, name: 'Classic Orange', hex: '#8d3a1e' },
  { no: 25, name: 'Light Rose', hex: '#b78c88' },
  { no: 26, name: 'Clean White', hex: '#ffffff' },
  { no: 27, name: 'Classic Black', hex: '#000000' },
  { no: 28, name: 'Orange Ginger', hex: '#c75f33' },
  { no: 29, name: 'Classic Maroon', hex: '#7c1416' },
  { no: 30, name: 'Chocolate', hex: '#833a2a' },
  { no: 31, name: 'Desert Army', hex: '#a99374' },
  { no: 32, name: 'Light Yellow', hex: '#eee192' },
  { no: 33, name: 'Mustard Yellow', hex: '#e8d560' },
  { no: 34, name: 'Grass Green', hex: '#287239' },
  { no: 35, name: 'Pink Ponk', hex: '#d382a6' },
  { no: 36, name: 'Neon Orange', hex: '#ee7036' },
  { no: 37, name: 'Cloud Blue', hex: '#76c0de' },
  { no: 38, name: 'Classic Blue', hex: '#1e2a3a' },
  { no: 39, name: 'Pinkish', hex: '#e381aa' },
  { no: 40, name: 'Lemorange', hex: '#e3915a' },
  { no: 41, name: 'Melon Melon', hex: '#dd3a3f' },
  { no: 42, name: 'Classic Purple', hex: '#b32c5d' },
  { no: 43, name: 'Pinkple', hex: '#e7416c' },
  { no: 44, name: 'Juicy Orange', hex: '#f6884a' },
  { no: 45, name: 'Donald Blue', hex: '#5871b6' },
  { no: 46, name: 'Sharp Tiffany', hex: '#d5e1d9' },
  { no: 47, name: 'Sea Green', hex: '#81a193' },
  { no: 48, name: 'Beach Blue', hex: '#627d88' },
  { no: 49, name: 'Light Purple', hex: '#c391a5' },
  { no: 50, name: 'Deem Purple', hex: '#d3a1c3' },
  { no: 51, name: 'Bright Purple', hex: '#ba94c5' },
  { no: 52, name: 'Blueple', hex: '#9570b1' },
  { no: 53, name: 'Purple', hex: '#3d1f53' },
  { no: 54, name: 'Pink Clay', hex: '#e3cdc8' },
  { no: 55, name: 'Grey Green', hex: '#d7c4bc' },
  { no: 56, name: 'Pearl', hex: '#e9c7dd' },
]

/** Only these yarn numbers may be suggested as a replacement. */
export const CATALOGUE_YARN_NOS: ReadonlySet<number> = new Set([
  9, 12, 13, 14, 15, 16, 17, 18, 19, 21, 23, 25, 26, 27, 29, 30, 31, 32, 35, 38, 46, 48, 52, 53, 54, 55, 56,
])

export const yarnColourByNo = (no: number): YarnColour | undefined => YARN_COLOURS.find((c) => c.no === no)

export interface PlainCode {
  letter: 'A' | 'H' | 'C'
  no: number
}

/** "A19" → { letter: 'A', no: 19 }. Anything else (other series, extra characters) → null. */
export function parsePlainCode(sku: string | null | undefined): PlainCode | null {
  const m = /^([AHC])(\d+)$/.exec((sku ?? '').trim().toUpperCase())
  if (!m) return null
  return { letter: m[1] as PlainCode['letter'], no: Number(m[2]) }
}
