"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function CoordinatorOnboardingEntry() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/onboarding?role=coordinator");
  }, [router]);

  return null;
}

