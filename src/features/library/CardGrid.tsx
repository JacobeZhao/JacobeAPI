import { ClipboardList, Copy, Download, Edit3, FileCode2, Heart, MoreHorizontal, Server, Trash2 } from "lucide-react";
import type { CardEntity, McpTool, Skill } from "../../domain/types";
import { IconButton } from "../../components/IconButton";

interface CardGridProps {
  cards: CardEntity[];
  onCopy: (card: CardEntity) => void;
  onCopyInstall: (skill: Skill) => void;
  onDownload: (skill: Skill) => void;
  onEdit: (card: CardEntity) => void;
  onDelete: (card: CardEntity) => void;
  onToggleFavorite: (card: CardEntity) => void;
}

function updatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近更新";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function SkillPreview({ skill }: { skill: Skill }) {
  return <p className="card-preview">{skill.prompt}</p>;
}

function McpPreview({ mcp }: { mcp: McpTool }) {
  return (
    <div className="mcp-command" aria-label="启动命令">
      <span className="mcp-command__prompt" aria-hidden="true">$</span>
      <code>{[mcp.command, ...mcp.args].join(" ")}</code>
    </div>
  );
}

export function CardGrid({ cards, onCopy, onCopyInstall, onDownload, onEdit, onDelete, onToggleFavorite }: CardGridProps) {
  return (
    <div className="card-grid" aria-label="内容列表">
      {cards.map((card) => (
        <article className={`library-card library-card--${card.kind}`} key={`${card.kind}-${card.id}`}>
          <header className="library-card__header">
            <div className={`entity-mark entity-mark--${card.kind}`} aria-hidden="true">
              {card.kind === "skill" ? <FileCode2 size={18} /> : <Server size={18} />}
            </div>
            <div className="library-card__title-wrap">
              <h3>{card.title}</h3>
              <span>{card.kind === "skill" ? "Skill" : card.serverName || "MCP 工具"}</span>
            </div>
            <IconButton
              label={card.favorite ? `取消收藏 ${card.title}` : `收藏 ${card.title}`}
              tone={card.favorite ? "active" : "default"}
              aria-pressed={card.favorite}
              onClick={() => onToggleFavorite(card)}
            >
              <Heart size={18} fill={card.favorite ? "currentColor" : "none"} />
            </IconButton>
          </header>

          <p className="library-card__description">{card.description || "还没有添加说明。"}</p>
          {card.kind === "skill" ? <SkillPreview skill={card} /> : <McpPreview mcp={card} />}

          <div className="tag-row" aria-label="标签">
            {card.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>{tag}</span>)}
            {card.tags.length > 3 ? <span className="tag tag--more" title={card.tags.slice(3).join("、")}>+{card.tags.length - 3}</span> : null}
          </div>

          <footer className="library-card__footer">
            <span className="updated-at">{updatedLabel(card.updatedAt)}</span>
            <div className="card-actions">
              <IconButton label={`编辑 ${card.title}`} onClick={() => onEdit(card)}><Edit3 size={17} /></IconButton>
              {card.kind === "skill" ? (
                <>
                  {card.installNotes ? <IconButton label={`复制使用说明 ${card.title}`} onClick={() => onCopyInstall(card)}><ClipboardList size={17} /></IconButton> : null}
                  <IconButton label={`下载 ${card.title}`} onClick={() => onDownload(card)}><Download size={17} /></IconButton>
                </>
              ) : null}
              <IconButton label={card.kind === "skill" ? `复制提示词 ${card.title}` : `复制 MCP 配置 ${card.title}`} onClick={() => onCopy(card)}><Copy size={17} /></IconButton>
              <IconButton label={`删除 ${card.title}`} tone="danger" onClick={() => onDelete(card)}><Trash2 size={17} /></IconButton>
            </div>
          </footer>
          <MoreHorizontal className="card-watermark" size={48} aria-hidden="true" />
        </article>
      ))}
    </div>
  );
}
