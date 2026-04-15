import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Link2, Image as ImageIcon, Video,
  Heading1, Heading2, Heading3, Minus, Undo, Redo, Palette, Highlighter,
  X, Upload, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "@/hooks/use-admin-auth";

interface EmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  bgColor: string;
  onBgColorChange: (color: string) => void;
}

const TEXT_COLORS = [
  "#000000", "#1a1a1a", "#333333", "#555555", "#777777", "#999999",
  "#ffffff", "#ff0000", "#e53e3e", "#ff6b35", "#f6ad55",
  "#f6e05e", "#68d391", "#48bb78", "#4299e1", "#3182ce",
  "#9f7aea", "#805ad5", "#ed64a6", "#d53f8c",
];

const HIGHLIGHT_COLORS = [
  "#fef9c3", "#fde68a", "#fcd34d", "#fca5a5", "#f9a8d4",
  "#c4b5fd", "#a5f3fc", "#86efac", "#bfdbfe", "#ffffff",
  "#000000", "#1e3a5f", "#065f46", "#7c2d12", "#4c1d95",
];

const BG_COLORS = [
  "#ffffff", "#f9fafb", "#f0f9ff", "#f0fdf4", "#fffbeb",
  "#fef2f2", "#fdf4ff", "#0f172a", "#1e293b", "#0f1b2d",
  "#1a1a2e", "#16213e", "#0d1b2a", "#1b2838",
];

function ColorPicker({ colors, value, onChange, label }: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="toolbar-btn flex items-center gap-1"
        style={{ borderBottom: `3px solid ${value}` }}
      >
        {label === "Texto" ? <Palette size={14} /> : label === "Fundo texto" ? <Highlighter size={14} /> : null}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 bg-[#1e1e2e] border border-white/20 rounded-lg p-3 shadow-2xl w-52">
          <p className="text-xs text-muted-foreground mb-2">{label}</p>
          <div className="grid grid-cols-5 gap-1 mb-2">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                className={cn(
                  "w-8 h-8 rounded border-2 transition-transform hover:scale-110",
                  value === c ? "border-primary" : "border-transparent"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-white/10">
            <input
              type="color"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
            />
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="flex-1 text-xs bg-white/5 border border-white/10 rounded px-2 py-1"
            />
            <button
              type="button"
              onClick={() => { onChange(custom); setOpen(false); }}
              className="text-xs text-primary hover:underline"
            >OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({ onClick, active, title, disabled, children }: {
  onClick: () => void;
  active?: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "toolbar-btn",
        active && "toolbar-btn-active",
        disabled && "opacity-30 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

export function EmailEditor({ value, onChange, bgColor, onBgColorChange }: EmailEditorProps) {
  const { getAuthHeaders } = useAdminAuth();
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ strike: false }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-blue-400 underline" } }),
      Image.configure({ HTMLAttributes: { class: "max-w-full rounded my-2" } }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "outline-none min-h-[300px] text-sm leading-relaxed",
        style: `background:${bgColor};padding:32px;`,
      },
    },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== value) {
      editor.commands.setContent(value, false);
    }
  }, [value]);

  useEffect(() => {
    if (editor) {
      editor.view.dom.setAttribute("style", `background:${bgColor};padding:32px;`);
    }
  }, [bgColor, editor]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-templates/upload-media`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.type === "video") {
        editor.commands.insertContent(`<video src="${data.url}" controls style="max-width:100%;border-radius:8px;margin:8px 0;"></video>`);
      } else {
        editor.chain().focus().setImage({ src: data.url }).run();
      }
    } catch {
      alert("Falha ao fazer upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const insertLink = () => {
    if (!editor || !linkUrl) return;
    editor.chain().focus().setLink({ href: linkUrl }).run();
    setLinkUrl("");
    setShowLinkInput(false);
  };

  if (!editor) return null;

  const textColor = (editor.getAttributes("textStyle") as { color?: string }).color ?? "#000000";
  const hlColor = (editor.getAttributes("highlight") as { color?: string }).color ?? "#fef9c3";

  return (
    <div className="rounded-xl border border-white/15 overflow-hidden">
      {/* Toolbar */}
      <style>{`
        .toolbar-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          border: none;
          background: transparent;
          cursor: pointer;
          color: rgb(156 163 175);
          transition: background 0.15s, color 0.15s;
          font-size: 13px;
        }
        .toolbar-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.1);
          color: white;
        }
        .toolbar-btn-active {
          background: rgba(var(--primary-rgb, 99,102,241), 0.2);
          color: hsl(var(--primary));
        }
      `}</style>

      <div className="bg-[#16162a] border-b border-white/10 px-3 py-2 flex flex-wrap items-center gap-1">
        {/* History */}
        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Desfazer" disabled={!editor.can().undo()}>
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Refazer" disabled={!editor.can().redo()}>
          <Redo size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Headings */}
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Título 1">
          <Heading1 size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Título 2">
          <Heading2 size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Título 3">
          <Heading3 size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Text format */}
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Negrito">
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Itálico">
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Sublinhado">
          <UnderlineIcon size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Tachado">
          <Strikethrough size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Colors */}
        <ColorPicker colors={TEXT_COLORS} value={textColor} onChange={(c) => editor.chain().focus().setColor(c).run()} label="Texto" />
        <ColorPicker colors={HIGHLIGHT_COLORS} value={hlColor} onChange={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()} label="Fundo texto" />

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Align */}
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="Alinhar à esquerda">
          <AlignLeft size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Centralizar">
          <AlignCenter size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="Alinhar à direita">
          <AlignRight size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("justify").run()} active={editor.isActive({ textAlign: "justify" })} title="Justificar">
          <AlignJustify size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Lists */}
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Lista">
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Lista numerada">
          <ListOrdered size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Linha divisória">
          <Minus size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Link */}
        <ToolbarBtn onClick={() => { setShowLinkInput((v) => !v); }} active={editor.isActive("link") || showLinkInput} title="Inserir link">
          <Link2 size={14} />
        </ToolbarBtn>

        {/* Media */}
        <ToolbarBtn onClick={() => fileRef.current?.click()} title="Upload imagem/vídeo" disabled={uploading}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
        </ToolbarBtn>
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload} />

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Email BG color */}
        <div className="flex items-center gap-1.5 ml-1">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Fundo email:</span>
          <ColorPicker colors={BG_COLORS} value={bgColor} onChange={onBgColorChange} label="" />
        </div>
      </div>

      {/* Link input row */}
      {showLinkInput && (
        <div className="bg-[#16162a] border-b border-white/10 px-3 py-2 flex items-center gap-2">
          <Link2 size={14} className="text-muted-foreground shrink-0" />
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") insertLink(); }}
            placeholder="https://exemplo.com"
            className="flex-1 text-sm bg-white/5 border border-white/10 rounded px-3 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <button type="button" onClick={insertLink} className="text-xs text-primary font-medium hover:underline">Inserir</button>
          <button type="button" onClick={() => { editor.chain().focus().unsetLink().run(); setShowLinkInput(false); }} className="text-xs text-red-400 hover:underline">Remover</button>
          <button type="button" onClick={() => setShowLinkInput(false)}><X size={14} className="text-muted-foreground" /></button>
        </div>
      )}

      {/* Editor area */}
      <div className="overflow-auto" style={{ background: bgColor }}>
        <EditorContent editor={editor} className="[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-72 [&_.ProseMirror_h1]:text-3xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:mb-3 [&_.ProseMirror_h2]:text-2xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h3]:text-xl [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_p]:mb-2 [&_.ProseMirror_hr]:border-gray-400 [&_.ProseMirror_hr]:my-4 [&_.ProseMirror_a]:text-blue-400 [&_.ProseMirror_a]:underline" />
      </div>
    </div>
  );
}
