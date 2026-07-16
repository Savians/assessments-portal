import { AdminClientWorkspace } from "@/components/admin-client-workspace";

export const metadata = { title: "Client Workspace | Savians Assessments" };
export default async function AdminClientPage({ params }: { params: Promise<{ sessionId: string }> }) { const { sessionId } = await params; return <AdminClientWorkspace sessionId={sessionId} />; }
