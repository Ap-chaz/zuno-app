// Admin access is now a normal signed-in account with role "admin" (see AdminGate).
// This file only keeps the old `adminLogout()` call working: it signs the account out.
import { authService } from "@/services/auth.service";

export function adminLogout(): void {
  void authService.logout();
}
