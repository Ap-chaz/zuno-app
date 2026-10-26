import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { transactionsService } from "@/services/transactions.service";
import type { TxStatus } from "@/types/models";

export const transactionKeys = {
  all: ["transactions"] as const,
  active: ["transactions", "active"] as const,
  detail: (id: string) => ["transactions", id] as const,
};

export function useTransactions() {
  return useQuery({
    queryKey: transactionKeys.all,
    queryFn: () => transactionsService.list(),
  });
}

export function useActiveTransactions() {
  return useQuery({
    queryKey: transactionKeys.active,
    queryFn: () => transactionsService.listActive(),
  });
}

export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: transactionKeys.detail(id ?? ""),
    queryFn: () => transactionsService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useUpdateTransactionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TxStatus }) =>
      transactionsService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.active });
    },
  });
}

export function useToggleTransactionFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, flagged }: { id: string; flagged: boolean }) =>
      transactionsService.toggleFlag(id, flagged),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    },
  });
}

export function useMarkPayoutPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => transactionsService.markPayoutPaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    },
  });
}

function invalidateTx(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: transactionKeys.all });
  queryClient.invalidateQueries({ queryKey: transactionKeys.active });
}

export function useShipTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; trackingNumber: string; courierName?: string; notes?: string }) =>
      transactionsService.ship(id, input),
    onSuccess: () => invalidateTx(queryClient),
  });
}

export function useConfirmDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => transactionsService.confirmDelivery(id),
    onSuccess: () => invalidateTx(queryClient),
  });
}

export function useApproveTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rating }: { id: string; rating?: { score: number; comment?: string } }) =>
      transactionsService.approve(id, rating),
    onSuccess: () => invalidateTx(queryClient),
  });
}

export function useCancelTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => transactionsService.cancel(id, reason),
    onSuccess: () => invalidateTx(queryClient),
  });
}
