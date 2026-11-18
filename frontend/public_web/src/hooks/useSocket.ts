import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import type { RealtimeItemUpdate } from "../types";

const SOCKET_URL = "http://development.localhost:9010/development.localhost";

export function usePublicWebSocket(onUpdate: (update: RealtimeItemUpdate) => void) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnectionDelay: 2000,
      withCredentials: true,
    });

    socket.on("connect", () => console.log("[public_web:socket] connected"));
    socket.on("disconnect", () => console.log("[public_web:socket] disconnected"));
    socket.on("connect_error", (err) => console.error("[public_web:socket] error", err.message));

    socket.on("item_update", (data: RealtimeItemUpdate) => {
      console.log("[public_web:socket] item_update", data);
      onUpdate(data);
    });

    socket.on("item_out_of_stock", (data: RealtimeItemUpdate) => {
      console.log("[public_web:socket] item_out_of_stock", data);
      onUpdate(data);
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [onUpdate]);

  return socketRef;
}
