"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function ContributorOnboardingEntry() {
  const router = useRouter();

  React.useEffect(() => {
    try {
      sessionStorage.setItem("itg_onboarding_requested_role", "contributor");
    } catch {
      // ignore
    }
    router.replace("/onboarding?role=contributor");
  }, [router]);

  return null;
}

