/**
 * SortableList / SortableItem — Story 4.2 (AC5). The reusable reorder primitive
 * used at all three levels (sections, groups, questions). Reorder is operable
 * THREE ways, per AC5:
 *   1. dnd-kit pointer drag (the grip handle)
 *   2. dnd-kit KeyboardSensor (focus the handle, Space + arrows)
 *   3. explicit move-up / move-down buttons (the touch-safe + a11y fallback —
 *      native HTML5 drag is touch-hostile and this is mobile-heavy Vietnam;
 *      the buttons double as the TEST-UX-2 keyboard path — Sally)
 *
 * Item ids are the array INDEX (scoped by `idPrefix` so nested lists never
 * collide). Index ids are stable across in-place content edits (the value
 * changes, the position does not), which keeps controlled inputs from losing
 * focus while typing; a reorder reassigns positions on drop, exactly as
 * intended.
 */
import { type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react'

export interface SortableListProps {
  /** Stable-per-list prefix so nested DndContexts never share an id. */
  idPrefix: string
  count: number
  onReorder: (from: number, to: number) => void
  ariaLabel: string
  children: ReactNode
}

export function SortableList({
  idPrefix,
  count,
  onReorder,
  ariaLabel,
  children,
}: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = Array.from({ length: count }, (_, i) => `${idPrefix}-${i}`)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from !== -1 && to !== -1) onReorder(from, to)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={ariaLabel} className="flex list-none flex-col gap-3 p-0">
          {children}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

export interface SortableItemProps {
  idPrefix: string
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  /** Accessible name for the item (e.g. "Section 1"), used on the reorder controls. */
  itemLabel: string
  children: ReactNode
}

export function SortableItem({
  idPrefix,
  index,
  total,
  onMoveUp,
  onMoveDown,
  itemLabel,
  children,
}: SortableItemProps) {
  const { t } = useTranslation()
  const id = `${idPrefix}-${index}`
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }

  return (
    <li ref={setNodeRef} style={style} className="rounded-md">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            type="button"
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label={t('exercises.editor.reorder.dragHandle', { item: itemLabel })}
            data-testid="reorder-drag-handle"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
            aria-label={t('exercises.editor.reorder.moveUp', { item: itemLabel })}
            data-testid="reorder-move-up"
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
            aria-label={t('exercises.editor.reorder.moveDown', { item: itemLabel })}
            data-testid="reorder-move-down"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </li>
  )
}
