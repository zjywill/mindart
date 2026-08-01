---
name: mindart
description: Open and operate the MindArt image genealogy canvas. Use when the user says /mindart, asks to open a MindArt board or image canvas, wants to organize reference images as a tree, or sends a compiled MindArt generation request that must be generated and applied back to a card.
---

# MindArt

## Open The Canvas

1. Resolve the user's active project or workspace directory as an absolute path.
2. Call `mindart_open_canvas` with `project_dir` set to that path. Pass `board_id` only when the user named an existing board.
3. Do not expose or ask the user to call internal canvas tools. Importing, editing, linking, and queueing happen in the widget.

## Complete A Generation Request

When the canvas sends a compiled request:

1. Treat every listed local reference path as image input. Preserve the numbered relationship between each image and its usage instruction.
2. Use the best image-generation capability currently available in the host.
3. Save or resolve the exact image file produced for this request. Do not guess from an old generated-images directory.
4. Call `mindart_apply_result` with the request id and exact local image path.
5. Do not stop after displaying the image in chat; the tool call is required to update the canvas.

If generation fails, call `mindart_report_error` with the request id and a concise actionable message.

## Capability Fallback

Probe the host's available image-generation tools or skills before acting. If none are available, report the request error through MindArt and tell the user which capability is missing. Never claim that an image was generated without a concrete output file.
