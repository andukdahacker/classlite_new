/**
 * PersonaCard — thin wrapper around the illustration + copy for a single
 * persona choice. Wrapped by `RadioGroupTiles` on the page so the tile
 * carries the `role="radio"` + `aria-checked` semantics.
 */
import type { ReactNode } from 'react'

export interface PersonaCardProps {
  illustration: ReactNode
  title: string
  lede: string
  description: string
  selected: boolean
}

export function PersonaCard({
  illustration,
  title,
  lede,
  description,
  selected,
}: PersonaCardProps) {
  return (
    <div
      className={
        'flex h-full cursor-pointer flex-col gap-3 rounded-lg border p-6 transition-colors ' +
        (selected
          ? 'border-slate-900 bg-white shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300')
      }
    >
      <div className="flex items-center justify-center">{illustration}</div>
      <h2 className="font-serif text-2xl italic">{title}</h2>
      <p className="text-sm text-slate-600">{lede}</p>
      {selected ? (
        <p className="mt-2 text-sm text-slate-700">{description}</p>
      ) : null}
    </div>
  )
}
