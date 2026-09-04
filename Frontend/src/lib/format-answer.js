export function parseAnswerBlocks(content) {
  const blocks = []
  let paragraph = []
  let bullets = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ type: 'list', items: bullets })
      bullets = []
    }
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushBullets()
      continue
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushBullets()
      blocks.push({ type: 'heading', text: heading[1] })
      continue
    }

    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      bullets.push(bullet[1])
      continue
    }

    flushBullets()
    paragraph.push(line)
  }

  flushParagraph()
  flushBullets()
  return blocks
}
