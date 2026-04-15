import { ChatClient } from "./_components/chat-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat" };

export default function ChatPage() {
  return <ChatClient />;
}
