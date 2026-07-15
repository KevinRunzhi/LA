# Voice Broadcast Demo — Design QA

- Date: 2026-07-15
- Final result: **passed**
- Viewport: 1280 × 720
- Reference: `C:/Users/Kevin/AppData/Local/Temp/codex-clipboard-8b1a3b81-1fbd-4cad-9ddd-8634f3276dcb.png`
- Full-view evidence: `output/design-qa/voice-broadcasting-full.png`
- Generating-state evidence: `output/design-qa/voice-generating.png`
- Focused implementation evidence: `output/design-qa/voice-broadcasting-capsule.png`
- Side-by-side comparison: `output/design-qa/voice-broadcast-reference-comparison.png`

## Surfaces checked

| Surface | Result | Notes |
| --- | --- | --- |
| Layout and spacing | Passed | The fixed bottom-center capsule stays within the guide panel's action area and does not block the assistant panel or primary step controls. |
| Shape and proportions | Passed | Rounded black capsule, circular cancel/confirm controls, double edge treatment, and compact proportions match the reference's visual grammar. |
| Color and contrast | Passed | Near-black body, gray cancel control, white confirm control, white waveform, and restrained cyan accent remain legible on the dark application shell. |
| Icon fidelity | Passed | Lucide X and Check icons retain the same semantic weight as the reference without introducing raster assets. |
| Waveform fidelity | Passed | A deterministic 19-bar Canvas waveform recreates the reference's dense vertical rhythm and adds a subtle cyan center accent. |
| Copy and typography | Passed | The broadcast state contains no extra copy; the generating state uses compact Chinese copy that remains readable without widening the reference-inspired capsule. |
| Motion | Passed | Entry, 4.5-second generation progress, message transitions, waveform motion, completion confirmation, and reduced-motion fallback were checked. |
| Accessibility | Passed | Status updates use `role="status"`/`aria-live`; icon buttons have explicit accessible names; Escape and visible cancel both close the demo. |

## Findings and iteration history

1. Initial Canvas sizing used `getBoundingClientRect()` while the waveform's reveal transform was active. This captured the transformed width and produced a low-resolution, blocky waveform.
2. Canvas sizing was changed to use the untransformed `clientWidth`/`clientHeight`, producing a 292 × 86 backing store for a 146 × 43 CSS canvas at 2× device scale.
3. Capsule footprint was reduced again to 190 × 50 px (about one-third less visible area than the previous 232 × 60 px version), with 34 px controls. Copy and font sizes remain unchanged.
4. Final side-by-side inspection found no remaining P0, P1, or P2 visual mismatch.

## Interaction evidence

- `语音播报` opens the generating state immediately.
- The first live status is `Agent 生成中。正在提取当前检修步骤`.
- The UI transitions to the animated waveform after 4.5 seconds.
- Confirm shows `播报完成` and closes after 650 ms.
- Cancel closes immediately.
- The guide remains on `确认告警与定位设备` after both exits.
- No speech synthesis, audio playback, microphone, or media-capture API is used.
