"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function OrgAdminOnboardingEntry() {
  const router = useRouter();

  React.useEffect(() => {
    try {
      sessionStorage.setItem("itg_onboarding_requested_role", "org-admin");
    } catch {
      // ignore
    }
    router.replace("/onboarding?role=org-admin");
  }, [router]);

  return null;
}

