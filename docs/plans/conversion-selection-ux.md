# Conversion selection UX plan

Scope: the empty and populated selection page before the user starts conversion.
The findings below record the original repository review. Implementation is now
complete; see the validation record at the end.

## Findings

The active route renders `ConversionOperationPanel` → `ConversionSelection`.
The older `libs/ui` upload UI is not rendered here. This explains why behavior
still present in older components is missing from the current page.

| Observation                                                 | Validation and cause                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No dropzone                                                 | Confirmed. `apps/web/app/routes/conversion/components/ConversionSelection.tsx` has a hidden file input and a Choose images button, but no drag handlers. The older `libs/ui/src/lib/file-upload/FilePicker.tsx` and `hooks/useDropzone.ts` provide a dashed drop target and drag feedback, but are not used here. That hook highlights its own target, not the whole page when a file enters elsewhere. |
| Output format consumes a separate row, including when empty | Confirmed. The selector is an unconditional child of the selection section's vertical flex layout, between the browse button and pending files. Whether it pushes content too far needs viewport verification, but the layout cause is clear.                                                                                                                                                           |
| Failed previews show a broken image                         | Confirmed missing handling. The active preview has no `onError` fallback. `useValidation.ts` creates object URLs without decoding images, so accepted files can still fail browser preview decoding. No preview fallback asset exists in `apps/web/public`. The older `FileListItem` has a text fallback but is unused here. HEIC preview failure itself has not been reproduced in a browser.          |
| Inconsistent cards and inaccessible long names              | Confirmed. Active cards have no shared width; their size depends on content. Only the image has a fixed 96px size, with no centering container. Names wrap through `break-words`; there is no bounded, scrollable filename area.                                                                                                                                                                        |
| Errors survive changes to the file list                     | Confirmed. `ConversionOperationPanel` passes `selection.addItems` and `selection.removeItem` directly. `useFileItems` appends rejection messages and neither operation clears old errors. The older `FileUpload` clears errors on selection and clear-all, but not individual removal.                                                                                                                  |
| Errors cannot be dismissed individually                     | Confirmed. The active error list renders text only, and `useFileItems` exposes only add-all/clear-all error operations. The older `ValidationErrors` provides paging, not dismissal.                                                                                                                                                                                                                    |

## Proposed layout

Empty state: heading and brief instructions, followed by a full-width dropzone
with a real **Choose images** button inside it. Hide output format and the
conversion action until at least one file is selected.

Populated state: keep the same dropzone above the pending-file grid, using a
compact height and copy such as “Drop more images here.” Below the grid, group
the file count, **Output format**, and **Start conversion** together. Put the
selector and action beside each other on wider screens and stack them on small
screens. Keep selection errors in a consistent area near the dropzone.

This makes adding files discoverable in both states and places the format choice
next to the action it controls. A separate dropzone component should contain the
browse button; the button alone should not be the drop target. Avoid an additional
standalone add button or a dropzone tile competing with image cards.

## Implementation steps and acceptance criteria

### 1. Restore drag-and-drop

- Create a focused selection dropzone component and reuse/export the existing
  `useDropzone` hook through the UI package boundary. Keep the active conversion
  workflow rather than restoring the older `FileUpload` form.
- Route browse and drop through the same selection/validation callback and respect
  the existing disabled state. Do not introduce clipboard behavior incidentally.
- Show a persistent dashed boundary. While external files are dragged over the
  page, emphasize the target; while over the target, add a stronger highlight and
  “Release to add images” text. Keep the browse button keyboard accessible with
  visible focus; color or animation must not be the only cue.
- Add file-only page drag tracking with cleanup on drop, page exit, and unmount.
  Prevent file drops outside the target from navigating away; only a drop within
  the target adds files. Do not intercept text dragging. Account for nested child
  enter/leave events so the highlight does not flicker or stick.
- Verify multiple-file drops, cancelled drags, nested targets, disabled behavior,
  keyboard browsing, and selecting the same file again after removing it.

### 2. Move output settings next to conversion

- Render the conversion controls only when `items.length > 0`, below the grid.
- Keep the selected MIME in `ConversionBatch`, as it is today. Adding/removing
  files, including removing the last file and adding again, must retain the
  user's format choice within the same batch.
- Preserve the existing output options, default WebP, label association, and
  submission behavior. Verify that the selected format reaches the manifest.
- Check empty, one-file, and many-file layouts at narrow and desktop widths.

### 3. Add a local preview fallback

- Add a simple repository-owned SVG placeholder at
  `apps/web/public/image-preview-unavailable.svg` and use it when a preview URL is
  absent or the image fires an error event.
- Display “Preview unavailable” rather than suggesting the original file is
  missing. Preview failure must not remove the file or prevent conversion.
- Track preview failure per file/URL and reset when the source changes. If the
  placeholder itself fails, use a text-only fallback to avoid an error loop.
- Test valid previews, forced decode failures, missing URLs, and placeholder
  failure. Include a browser HEIC case where available, without assuming every
  browser necessarily rejects HEIC previews.

### 4. Standardize pending cards

- Extract a pending-file card used by the active selection component. Use a
  consistent card width (approximately 220px, capped by container width), a fixed
  preview area, and centered `object-contain` images. Keep removal controls in a
  consistent position without overlapping previews or names.
- Use a bounded single-line filename region with horizontal scrolling. Support
  touch and keyboard scrolling, preserve the full accessible filename, and give
  any focusable scroll region a visible focus indicator. A tooltip alone is not
  sufficient access to the name.
- Verify portrait/landscape images, fallback images, long unbroken filenames,
  narrow viewports, and zoom. Names must not resize cards or overflow the page.
- Leave completed/download cards unchanged unless sharing a primitive is needed;
  do not expand this into a redesign of post-submission UI.

### 5. Clear stale errors on selection changes

- Put the rule in `useFileItems`, so callers do not have to remember it: a
  nonempty add attempt replaces previous errors with the current attempt's
  rejection messages; removal and clear-all clear all selection errors.
- Preserve new validation errors from the current selection. For example, adding
  one valid and one oversized file clears historical errors, adds the valid file,
  and reports only the new oversized-file rejection. Cancelling the chooser or
  dropping no files is a no-op.
- Cover valid-only, invalid-only, mixed selections, duplicates, removal of the
  final file, and clear-all. Preserve object URL cleanup.
- Scope “all errors” here to pre-submission selection errors. Controller errors
  are rendered separately after submit: `submit()` immediately sets `submitted`
  and hides selection, even if session/batch creation fails. Those messages also
  control retries and access guards. Do not erase controller state to implement
  selection-message clearing or dismissal.

### 6. Dismiss individual errors

- Give selection errors stable IDs and a `dismissError(id)` operation, updating
  existing hook consumers as needed. Keep duplicate messages independently
  dismissible rather than removing by message text.
- Render an explicit `type="button"` close control for each message, with an
  accessible name identifying the error. Keep validation announcements available
  to screen readers without announcing the full list on every dismissal.
- After dismissal, keep focus predictable: next dismiss button, previous button,
  or Choose images when no errors remain. Remove the empty error container.
- Test dismissing first/middle/last messages, repeated identical messages, and
  subsequent validation showing a new error again. Dismissal changes neither the
  selected files nor validation rules.

## Validation and delivery

Implement error lifecycle/dismissal first, then dropzone and layout, then cards
and fallback. No new production dependencies or backend changes are expected.

Add targeted Vitest coverage for `useFileItems`, the dropzone, and selection UI.
Extend `apps/web-e2e/src/integration/upload.spec.ts` for drag/drop, error lifecycle,
fallback, responsive card geometry, and output selection. Retain the existing
keyboard chooser and conversion integration checks.

Use the existing npm/Nx workflow:

```sh
npx nx run-many -t test typecheck lint -p @image-web-convert/web @image-web-convert/ui
npx nx run @image-web-convert/web-e2e:browser-integration
```

The browser integration target builds the web app and runs the configured
Chromium, Firefox, and WebKit projects with mocked API routes. Review empty and
populated states at mobile/desktop widths, both themes, keyboard-only input, and
zoom. Review the final diff and report any unavailable checks or failures.

## Implementation record

Implemented the selection dropzone, conditional conversion controls, local SVG
fallback, uniform pending cards with keyboard-scrollable filenames, centralized
error clearing, and individual error dismissal with focus restoration. Existing
string-error consumers remain compatible; the active page uses stable error IDs.
The browser-test TypeScript configuration now includes DOM types for browser-side
assertions. No production dependencies were added.

Validation: 112 web/UI unit tests passed; web/UI/browser-test typechecking and
lint passed (existing unrelated lint warnings remain). Production web build
passed. Firefox and WebKit validation is unavailable because the container lacks
the required system libraries. Browser binaries were downloaded into the ignored
workspace cache rather than changing system packages.

Chromium: 13 existing integration checks passed; the two new checks passed on a
targeted rerun after correcting a fixture assumption about file modification
times. These include light/dark mobile/desktop controls, keyboard browsing,
selection changes, drag/drop rejection, dismissal focus, card widths, filename
overflow, and local fallback loading. Actual HEIC decoding and manual zoom/screen
reader verification were not performed.
