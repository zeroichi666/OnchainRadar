import { TokenDetail } from "@/components/token-detail";

export default async function TokenDetailPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  return <TokenDetail chain={chain} address={address} />;
}
