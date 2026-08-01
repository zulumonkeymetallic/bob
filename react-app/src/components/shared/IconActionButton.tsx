import React from 'react';
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';

/**
 * A 24px icon-only button whose label appears almost immediately on hover.
 *
 * Card action rows carry six or more unlabelled 12px glyphs. They did have labels — as the
 * native `title` attribute — but the browser only shows those after roughly a second of
 * hovering, unstyled and easy to miss entirely, so in practice the row read as a set of
 * anonymous symbols. Confirmed by Jim, 2026-08-01: "there are a lot [of icons], I'm the owner
 * and I can't keep track."
 *
 * `title` is deliberately NOT set alongside the tooltip: with both, the native one appears a
 * second after the styled one and you get two labels stacked. `aria-label` carries the same
 * text for screen readers, which is what `title` was doing for accessibility anyway.
 *
 * `onPointerDown` stops propagation by default because every current caller sits inside a
 * draggable card — without it, pressing an action starts a drag.
 */
export interface IconActionButtonProps {
  /** Tooltip text and accessible name. */
  label: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  /** Overrides the default muted colour — e.g. a delegation state or a set priority. */
  color?: string;
  opacity?: number;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}

const IconActionButton: React.FC<IconActionButtonProps> = ({
  label,
  onClick,
  disabled = false,
  color,
  opacity,
  placement = 'top',
  children,
}) => {
  const button = (
    <Button
      variant="link"
      size="sm"
      className="p-0"
      style={{ width: 24, height: 24, color, opacity }}
      aria-label={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
    >
      {children}
    </Button>
  );

  // A disabled Bootstrap button fires no pointer events, so OverlayTrigger never sees a hover
  // and the tooltip silently stops working — which matters most for the disabled cases, where
  // the label is the only thing explaining WHY it is disabled ("Already has calendar event").
  // The wrapper span restores the hover target.
  return (
    <OverlayTrigger placement={placement} delay={{ show: 120, hide: 0 }} overlay={<Tooltip>{label}</Tooltip>}>
      {disabled
        ? <span style={{ display: 'inline-flex' }}>{button}</span>
        : button}
    </OverlayTrigger>
  );
};

export default IconActionButton;
