"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function CoordinatorOnboardingEntry() {
  const router = useRouter();

  React.useEffect(() => {
    try {
      sessionStorage.setItem("itg_onboarding_requested_role", "coordinator");
    } catch {
      // ignore
    }
    router.replace("/onboarding?role=coordinator");
  }, [router]);

  return null;
}

