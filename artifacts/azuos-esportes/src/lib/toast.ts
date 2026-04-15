import { toast } from "sonner";
import React from "react";

export const showToast = {
  success: (message: string) => toast.success(message, {
    position: "bottom-right",
    duration: 3000,
  }),
  error: (message: string) => toast.error(message, {
    position: "bottom-right",
    duration: 4000,
  }),
  info: (message: string) => toast.info(message, {
    position: "bottom-right",
    duration: 3000,
  }),
  loading: (message: string) => toast.loading(message, {
    position: "bottom-right",
  }),
};

let confirmResolve: ((value: boolean) => void) | null = null;
let matchResultResolve: ((value: { pair1Sets: number; pair2Sets: number } | null) => void) | null = null;

export const showConfirm = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    const event = new CustomEvent("showConfirmModal", { detail: { message } });
    window.dispatchEvent(event);
  });
};

export const showMatchResult = (
  pair1Name: string,
  pair2Name: string,
  pair1Sets: number = 0,
  pair2Sets: number = 0
): Promise<{ pair1Sets: number; pair2Sets: number } | null> => {
  return new Promise((resolve) => {
    matchResultResolve = resolve;
    const event = new CustomEvent("showMatchResultModal", {
      detail: { pair1Name, pair2Name, pair1Sets, pair2Sets },
    });
    window.dispatchEvent(event);
  });
};

export const getConfirmResolver = () => confirmResolve;
export const setConfirmResolver = (resolver: ((value: boolean) => void) | null) => {
  confirmResolve = resolver;
};

export const getMatchResultResolver = () => matchResultResolve;
export const setMatchResultResolver = (resolver: ((value: { pair1Sets: number; pair2Sets: number } | null) => void) | null) => {
  matchResultResolve = resolver;
};
