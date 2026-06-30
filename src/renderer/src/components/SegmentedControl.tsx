interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}

/** The app's `.kind-tabs` pill group — one selectable segment per option. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange
}: SegmentedControlProps<T>): JSX.Element {
  return (
    <div className="kind-tabs">
      {options.map((o) => (
        <button
          key={o.value}
          className={`seg ${value === o.value ? 'active' : ''}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
