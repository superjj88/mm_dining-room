import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import type { RealtimeItemUpdate } from "../types";

const SOCKET_URL = "http://development.localhost:9010/development.localhost";

export function useRealtime(onItemUpdate: (update: RealtimeItemUpdate) => void) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnectionDelay: 1000,
      withCredentials: true,
    });

    socket.on("connect", () => console.log("[socket] connected"));
    socket.on("disconnect", () => console.log("[socket] disconnected"));
    socket.on("item_update", (data: RealtimeItemUpdate) => {
      onItemUpdate(data);
    });
    socket.on("item_out_of_stock", (data: RealtimeItemUpdate) => {
      onItemUpdate(data);
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
    };
  }, [onItemUpdate]);

  return socketRef;
}

export function useKeyboardRFID(onBadge: (badgeId: string) => void) {
  const bufferRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore while typing into a text field (search / badge inputs).
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")
      ) {
        return;
      }

      if (e.key === "Enter") {
        if (bufferRef.current.length >= 4) {
          onBadge(bufferRef.current.trim());
        }
        bufferRef.current = "";
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }
      if (/^\d$/.test(e.key)) {
        bufferRef.current += e.key;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          bufferRef.current = "";
        }, 500);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onBadge]);
}
