import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService } from "@/services/admin.service";

const k = (name: string, ...rest: unknown[]) => ["admin", name, ...rest] as const;

export const useAdminKyc = () => useQuery({ queryKey: k("kyc"), queryFn: () => adminService.kycQueue() });
export const useAdminUsers = (role?: "buyer" | "seller", q?: string) =>
  useQuery({ queryKey: k("users", role, q), queryFn: () => adminService.users(role, q) });
export const useAdminPayouts = (status?: string) =>
  useQuery({ queryKey: k("payouts", status), queryFn: () => adminService.payouts(status) });
export const useAdminTransactions = (status?: string, q?: string) =>
  useQuery({ queryKey: k("transactions", status, q), queryFn: () => adminService.transactions(status, q) });
export const useAdminMetrics = () => useQuery({ queryKey: k("metrics"), queryFn: () => adminService.metrics() });
export const useAdminDisputes = () =>
  useQuery({ queryKey: k("disputes"), queryFn: async () => (await import("@/services/disputes.service")).disputesService.adminList() });

function useAdminMutation<A>(fn: (a: A) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }) });
}

export const useReviewKyc = () =>
  useAdminMutation((a: { id: string; decision: "APPROVED" | "REJECTED"; notes: string; reason?: string }) =>
    adminService.reviewKyc(a.id, a.decision, a.notes, a.reason));
export const useSetTier = () => useAdminMutation((a: { id: string; tier: 1 | 2; notes: string }) => adminService.setTier(a.id, a.tier, a.notes));
export const useSuspend = () => useAdminMutation((a: { id: string; reason: string; days: number }) => adminService.suspend(a.id, a.reason, a.days));
export const useUnsuspend = () => useAdminMutation((id: string) => adminService.unsuspend(id));
export const useRetryPayout = () => useAdminMutation((a: { id: string; confirmedNotPaid?: boolean }) => adminService.retryPayout(a.id, a.confirmedNotPaid));
