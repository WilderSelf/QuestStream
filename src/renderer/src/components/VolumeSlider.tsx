interface VolumeSliderProps {
  /** Current value in [0,1]. */
  value: number
  /** Called with the parsed [0,1] value on change. */
  onChange: (value: number) => void
  ariaLabel: string
  title?: string
  /** Slider granularity (default 0.01). */
  step?: number
  className?: string
}

/** A 0..1 range input — the app's one volume/gain control. */
export function VolumeSlider({
  value,
  onChange,
  ariaLabel,
  title,
  step = 0.01,
  className
}: VolumeSliderProps): JSX.Element {
  return (
    <input
      type="range"
      className={className}
      min={0}
      max={1}
      step={step}
      value={value}
      aria-label={ariaLabel}
      title={title}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  )
}
