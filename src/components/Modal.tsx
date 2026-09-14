import type { ReactNode } from 'react'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 860 } : undefined} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
