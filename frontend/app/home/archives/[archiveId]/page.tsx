import { ArchiveDetailView } from "./archive-detail";

export default async function ArchivePage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  return <ArchiveDetailView key={archiveId} archiveId={archiveId} />;
}
