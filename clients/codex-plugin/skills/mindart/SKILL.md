---
name: mindart
description: Open and operate the MindArt image genealogy canvas. Use when the user says /mindart, asks to open a MindArt board or image canvas, wants to organize reference images as a tree, sends a compiled MindArt generation request that must be generated and applied back to a card, or asks where MindArt came from and how to update it.
---

# MindArt

## Open The Canvas

1. Resolve the user's active project or workspace directory as an absolute path.
2. Call `mindart_open_canvas` with `project_dir` set to that path. Pass `board_id` only when the user named an existing board.
3. Do not expose or ask the user to call internal canvas tools. Importing, editing, linking, and queueing happen in the widget.

## Keep The Board A Genealogy

A MindArt board records where every image came from, and the canvas draws those
records as the map. One rule decides every connection:

**A card's parent is the image you actually fed to the generator.**

Not what the result resembles, and not what it is about — what went in. Every
other image you fed becomes a numbered reference on the same card, in the order
you passed it, each with a note saying what you took from it. Reference 1 is
always the parent.

Import a generated image like this:

```
mindart_import_image(
  board_id, source_path, title,
  parent_node_id = <the card whose image you built on>,
  sources = [{ node_id, usage }, ...],   # every card you fed, in generator order
  prompt = <the instruction you used>
)
```

Call `mindart_get_board` first whenever you do not already know the node ids.
Never guess one. If a source image is not on the board yet, import it first —
with no parent, because the user supplied it — and use the node id it returns.

`mindart_import_image` reports the sources it recorded. If it says none were
recorded and the image was in fact derived from cards on the board, fix it with
`mindart_link_sources` before replying.

## Choosing The Connection

| What you generated | `parent_node_id` | `sources` |
|---|---|---|
| Nothing — the user supplied the file | omit | omit |
| From text only, no image fed in | omit | omit |
| An edit of one card's image | that card | that card |
| An edit of one card, guided by another | the card you edited | the edited card first, then the guide |
| A combination of several cards | the card supplying the subject | every card you fed, in order |
| A crop, upscale, background removal, or aspect change | the card it came from | that card |
| Another attempt after the user rejected a result | the rejected card's **parent** | the rejected card's sources |
| Several variants in one go | the same parent for every variant | the same sources for every variant |

When several images went in and the parent is not obvious, the parent is the one
supplying the subject — the character, object, or scene that carries forward.
Style, palette, composition, and lighting references are never the parent. If
two images both supply subject, pick the one that occupies more of the result,
and failing that the one the user named first.

Editing is how a branch grows: each accepted change hangs off the image it was
made from, so the branch reads as that image's edit history. Two shapes are easy
to get wrong:

- **Variants are siblings, not a chain.** Four options from one prompt all hang
  off the same parent. Chaining them claims each was generated from the last.
- **A retry is a sibling of what it replaces, not its child.** You fed the
  rejected card's inputs again, not the rejected card itself, so it belongs
  beside that card. Making it a child records a derivation that never happened.

Do not create a card for a generation that failed.

## Write Down What Each Source Contributed

The `usage` note on a source is what the connection means, and the canvas
replays it when the user regenerates the card. Say what you took, in the user's
language:

```
sources = [
  { node_id: "node-298170d2-1", usage: "保留头部特征、五官与配色" },
  { node_id: "node-5bf9de1b-1", usage: "沿用绿色圆角方形 icon 的构图与质感" },
]
```

An empty note leaves the card regenerable only from its prompt, which loses the
per-image instructions you just used.

## Correct A Card's Lineage

Use `mindart_link_sources` when a card is already on the board and its sources
are missing or wrong, including when the user describes a relationship between
two existing images. Setting `parent_node_id` moves the card onto its primary
source's branch; `sources` replaces its references. Omit `sources` to re-parent
a card while keeping the references it already has.

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

## Where MindArt Comes From

MindArt is developed at https://github.com/zjywill/mindart and installed from
that repository, not downloaded file by file. The version in use is the
`version` field of `.codex-plugin/plugin.json`; the newest published version is that
same field on the repository's `main` branch.

When the user wants a newer MindArt, give them these two commands rather than
sending them to hunt for files on GitHub:

```bash
codex plugin marketplace upgrade mindart
codex plugin add mindart@mindart
```

The first refreshes the marketplace from the repository, the second reinstalls
MindArt from the refreshed copy. On a Dim host the second command is
`dim plugin install mindart@mindart`. Start a new session afterwards so the updated
MCP server and this skill are loaded.
