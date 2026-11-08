// The bar over every example's board, a walkthrough's or a starter's: open it in the editor, download its text, and
// whatever else the board offers (a walkthrough's exports).
import type { MouseEvent, ReactNode } from 'react'

export function Actions({
  name,
  source,
  edit,
  onEdit,
  editLabel = 'Edit in the editor ⤢',
  children,
}: {
  /** The file's name without `.loadmap`. */
  name: string
  source: string
  /** Where the editor opens it; none, no link. */
  edit?: string
  onEdit?: (e: MouseEvent<HTMLAnchorElement>) => void
  editLabel?: string
  children?: ReactNode
}) {
  return (
    <div className="actions">
      {edit && (
        <a className="button" href={edit} onClick={onEdit}>
          {editLabel}
        </a>
      )}
      {/* the text to open in the reader's own editor */}
      <a
        className="button"
        download={`${name}.loadmap`}
        href={`data:text/plain;charset=utf-8,${encodeURIComponent(source)}`}
      >
        {name}.loadmap ↓
      </a>
      {children}
    </div>
  )
}
