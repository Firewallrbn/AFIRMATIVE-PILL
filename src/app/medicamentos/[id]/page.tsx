import { MedicationDetailView } from '@/components/medication-detail';

/**
 * En Next.js 16 los `params` de una ruta dinámica llegan como Promise y hay que
 * esperarlos. El Server Component solo resuelve el id y delega los datos al Client
 * Component, que es donde vive Apollo.
 */
export default async function MedicationPage({ params }: PageProps<'/medicamentos/[id]'>) {
  const { id } = await params;
  return <MedicationDetailView id={id} />;
}
