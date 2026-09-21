import { OrderTracker } from '@/components/order-tracker';

export default async function OrderPage({ params }: PageProps<'/ordenes/[id]'>) {
  const { id } = await params;
  return <OrderTracker orderId={id} />;
}
