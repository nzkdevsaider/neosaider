"use client";

import dynamic from "next/dynamic";

export const ClientChat = dynamic(
  () => import("@/components/chat").then((module) => module.Chat),
  { ssr: false },
);
