import { useMemo, useState } from 'react'
import { useStore } from '../store'
import type { Song } from '@shared/types'
import {
  KIND_ORDER,
  KIND_LABELS,
  dimensionsFor,
  labelForDimension,
  labelForValue,
  parseTag,
  valuesPresent
} from '@shared/taxonomy'
import {
  SongRow,
  useMatchingSongIds,
  ArtistsPane,
  AlbumsPane,
  SongsPane
} from './Browser'

const UNTAGGED = '__untagged__'

/**
 * The library browser: three kind tabs (Music / Ambience / Soundboard), an accordion
 * that buckets the kind's items by a chosen tag dimension, and secondary chips that
 * filter by the other dimensions. An optional toggle reveals the legacy
 * Artist → Album → Song columns.
 */
export function LibraryPane(): JSX.Element {
  const songs = useStore((s) => s.library.songs)
  const kind = useStore((s) => s.kindTab)
  const setKindTab = useStore((s) => s.setKindTab)
  const groupByMap = useStore((s) => s.groupBy)
  const setGroupBy = useStore((s) => s.setGroupBy)
  const filtersMap = useStore((s) => s.activeFilters)
  const setKindFilter = useStore((s) => s.setKindFilter)
  const clearKindFilters = useStore((s) => s.clearKindFilters)
  const showArtistView = useStore((s) => s.showArtistView)
  const toggleArtistView = useStore((s) => s.toggleArtistView)
  const setImportWizardOpen = useStore((s) => s.setImportWizardOpen)
  const matching = useMatchingSongIds()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleSection = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const dims = dimensionsFor(kind)
  const groupBy = groupByMap[kind]
  const filters = filtersMap[kind]
  const otherDims = dims.filter((d) => d.key !== groupBy)

  // Songs of this kind, passing the search and every active secondary filter.
  const visible = useMemo(() => {
    const activeEntries = Object.entries(filters).filter(([, v]) => v) as [string, string][]
    return songs.filter((s) => {
      if ((s.kind ?? 'track') !== kind) return false
      if (matching && !matching.has(s.id)) return false
      for (const [dim, value] of activeEntries) {
        const has = (s.tags ?? []).some((t) => {
          const p = parseTag(t)
          return p.dim === dim && p.value === value
        })
        if (!has) return false
      }
      return true
    })
  }, [songs, kind, matching, filters])

  // Bucket the visible songs by their value(s) in the grouping dimension.
  const buckets = useMemo(() => {
    const map = new Map<string, Song[]>()
    for (const s of visible) {
      const values = (s.tags ?? [])
        .map(parseTag)
        .filter((p) => p.dim === groupBy && p.value)
        .map((p) => p.value)
      const keys = values.length ? values : [UNTAGGED]
      for (const k of keys) {
        const arr = map.get(k) ?? []
        arr.push(s)
        map.set(k, arr)
      }
    }
    // valuesPresent already returns values in curated-then-observed order; reuse it as the
    // canonical order (every non-UNTAGGED bucket key appears in it), Untagged last.
    const ordered = valuesPresent(visible, kind, groupBy)
      .filter((v) => map.has(v.value))
      .map((v) => [v.value, map.get(v.value)!] as const)
    if (map.has(UNTAGGED)) ordered.push([UNTAGGED, map.get(UNTAGGED)!])
    return ordered
  }, [visible, kind, groupBy])

  // Secondary-filter chip rows: the present values for each non-grouping dimension. Memoized
  // so we don't re-scan every visible song per dimension on each render (e.g. on filter toggle).
  const filterRows = useMemo(
    () =>
      otherDims
        .map((d) => ({ dim: d.key, values: valuesPresent(visible, kind, d.key) }))
        .filter((r) => r.values.length > 0),
    [visible, kind, groupBy] // otherDims is derived from (kind, groupBy)
  )

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  return (
    <div className="pane library-pane">
      <div className="pane-header library-head">
        <div className="kind-tabs">
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              className={`seg ${kind === k ? 'active' : ''}`}
              aria-pressed={kind === k}
              onClick={() => setKindTab(k)}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <span className="library-head-actions">
          <button
            className={`icon ${showArtistView ? 'toggled' : ''}`}
            title="Toggle Artist / Album view"
            aria-label="Artist / Album view"
            aria-pressed={showArtistView}
            onClick={toggleArtistView}
          >
            🗂
          </button>
          <button
            className="icon"
            title="Import with the tagging wizard"
            aria-label="Import audio"
            onClick={() => setImportWizardOpen(true)}
          >
            ＋
          </button>
        </span>
      </div>

      {showArtistView ? (
        <div className="artist-view">
          <ArtistsPane />
          <AlbumsPane />
          <SongsPane />
        </div>
      ) : (
        <>
          <div className="library-controls">
            <label className="group-by">
              <span>Group by</span>
              <select value={groupBy} onChange={(e) => setGroupBy(kind, e.target.value)}>
                {dims.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            {activeFilterCount > 0 && (
              <button className="link-btn" onClick={() => clearKindFilters(kind)}>
                Clear filters ({activeFilterCount})
              </button>
            )}
          </div>

          {filterRows.map(({ dim, values }) => (
            <div className="filter-row" key={dim}>
              <span className="filter-label">{labelForDimension(dim)}</span>
              {values.map((v) => {
                const on = filters[dim] === v.value
                return (
                  <button
                    key={v.value}
                    className={`tag-chip ${on ? 'active' : ''}`}
                    onClick={() => setKindFilter(kind, dim, on ? null : v.value)}
                  >
                    {v.label}
                  </button>
                )
              })}
            </div>
          ))}

          <div className="pane-body">
            {visible.length === 0 && (
              <div className="muted">
                No {KIND_LABELS[kind].toLowerCase()} items yet. Use ＋ to import and tag some.
              </div>
            )}
            {buckets.map(([key, items]) => {
              const isOpen = !collapsed.has(key)
              const title = key === UNTAGGED ? 'Untagged' : labelForValue(groupBy, key)
              return (
                <div className="accordion" key={key}>
                  <button
                    className="accordion-head"
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(key)}
                  >
                    <span className="accordion-caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <span className="accordion-title">{title}</span>
                    <span className="tag-count">{items.length}</span>
                  </button>
                  {isOpen && items.map((s) => <SongRow key={s.id} song={s} />)}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
