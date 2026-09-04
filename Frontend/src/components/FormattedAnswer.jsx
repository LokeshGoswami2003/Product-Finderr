import { parseAnswerBlocks } from '../lib/format-answer'

function renderInlineText(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
      : part,
  )
}

export function FormattedAnswer({ content }) {
  return (
    <div className="message-content message-content--formatted">
      {parseAnswerBlocks(content).map((block, index) => {
        if (block.type === 'heading') {
          return <h3 key={`${block.type}-${index}`}>{renderInlineText(block.text)}</h3>
        }
        if (block.type === 'list') {
          return (
            <ul key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInlineText(item)}</li>
              ))}
            </ul>
          )
        }
        return <p key={`${block.type}-${index}`}>{renderInlineText(block.text)}</p>
      })}
    </div>
  )
}
