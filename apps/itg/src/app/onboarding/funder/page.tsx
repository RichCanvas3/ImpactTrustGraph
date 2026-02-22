"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function FunderOnboardingEntry() {
  const router = useRouter();

  React.useEffect(() => {
    try {
      sessionStorage.setItem("itg_onboarding_requested_role", "funder");
    } catch {
      // ignore
    }
    router.replace("/onboarding?role=funder");
  }, [router]);

  return null;
}

