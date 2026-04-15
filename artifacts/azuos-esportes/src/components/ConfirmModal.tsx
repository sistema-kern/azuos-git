import { useState, useEffect } from "react";
import { getConfirmResolver, setConfirmResolver } from "@/lib/toast";

export function ConfirmModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handleShowConfirm = (e: Event) => {
      const event = e as CustomEvent;
      setMessage(event.detail.message);
      setIsOpen(true);
    };

    window.addEventListener("showConfirmModal", handleShowConfirm);
    return () => window.removeEventListener("showConfirmModal", handleShowConfirm);
  }, []);

  const handleConfirm = (value: boolean) => {
    const resolver = getConfirmResolver();
    if (resolver) resolver(value);
    setConfirmResolver(null);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl p-8 max-w-sm w-[90%] border border-white/10 animate-in fade-in zoom-in-95 duration-200">
        <p className="text-white text-center text-lg font-medium mb-8 leading-relaxed">
          {message}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => handleConfirm(false)}
            className="px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wider bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-colors duration-200"
          >
            Cancelar
          </button>
          <button
            onClick={() => handleConfirm(true)}
            className="px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-200"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
