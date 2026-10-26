import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sellersService } from "@/services/sellers.service";

export const sellerKeys = {
  all: ["sellers"] as const,
  detail: (id: string) => ["sellers", id] as const,
  search: (query: string, category: string) => ["sellers", "search", query, category] as const,
};

/** Every seller a buyer can start a deal with (New Escrow dropdown). */
export function useSellers() {
  return useQuery({
    queryKey: [...sellerKeys.all, "bookable"] as const,
    queryFn: () => sellersService.listAll(),
  });
}

/** Up to 10 sellers matching `query`, for the New Escrow picker. */
export function useSellerPicker(query: string) {
  return useQuery({
    queryKey: [...sellerKeys.all, "picker", query] as const,
    queryFn: () => sellersService.searchBookable(query, 10),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

export function useSeller(id: string | undefined) {
  return useQuery({
    queryKey: sellerKeys.detail(id ?? ""),
    queryFn: () => sellersService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useSellerSearch(query: string, category: string) {
  return useQuery({
    queryKey: sellerKeys.search(query, category),
    queryFn: () => sellersService.search(query, category),
    placeholderData: (prev) => prev,
  });
}

export function useToggleSellerSuspend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      sellersService.toggleSuspend(id, suspended),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sellerKeys.all });
    },
  });
}
