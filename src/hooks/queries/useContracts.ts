import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contractsService } from "@/services/contracts.service";
import { transactionsService } from "@/services/transactions.service";
import { transactionKeys } from "@/hooks/queries/useTransactions";

export const contractKeys = { all: ["contracts"] as const };

export function useContracts() {
  return useQuery({ queryKey: contractKeys.all, queryFn: () => contractsService.list() });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: contractsService.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useRespondToContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; action: "confirm" | "reject"; text: string }) => {
      if (input.action === "confirm") {
        await contractsService.confirm(input.id, input.text);
        // Agreed: create the payable transaction right away; the buyer is texted the link.
        return contractsService.createTransaction(input.id);
      }
      await contractsService.reject(input.id, input.text);
      return null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contractKeys.all });
      qc.invalidateQueries({ queryKey: transactionKeys.all });
    },
  });
}

export function useFeeQuote(amount: number) {
  return useQuery({
    queryKey: ["fee-quote", amount],
    queryFn: () => transactionsService.quote(amount),
    enabled: amount >= 100,
    placeholderData: (prev) => prev,
  });
}
