"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Card, CardContent, Container, LinearProgress, Typography } from "@mui/material";
import { useConnection } from "../../components/connection-context";
import { useWeb3Auth } from "../../components/Web3AuthProvider";
import { useDefaultOrgAgent } from "../../components/useDefaultOrgAgent";

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useConnection();
  const { isInitializing: isWeb3AuthInitializing } = useWeb3Auth();
  const { defaultOrgAgent, isLoading: isLoadingAgent } = useDefaultOrgAgent();

  const [error, setError] = React.useState<string | null>(null);

  const loading = isWeb3AuthInitializing || isLoadingAgent;

  React.useEffect(() => {
    if (!user) {
      setError(null);
      return;
    }
    if (loading) return;
    if (!defaultOrgAgent) {
      setError("No default organization agent is set. Complete onboarding to register/select your organization agent.");
    } else {
      setError(null);
    }
  }, [user, loading, defaultOrgAgent]);

  return (
    <main>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Selected organization summary.
          </Typography>
        </Box>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

        {loading ? (
          <LinearProgress />
        ) : (
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography sx={{ fontWeight: 800, mb: 0.75 }}>Selected organization</Typography>
              <Typography variant="body2" color="text.secondary">
                {defaultOrgAgent?.name || defaultOrgAgent?.agentName || defaultOrgAgent?.ensName || "None"}
              </Typography>

              <Box sx={{ mt: 2, display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button variant="contained" onClick={() => router.push("/organization-settings")}>
                  Organization Settings
                </Button>
                <Button variant="outlined" onClick={() => router.push("/agents")}>
                  Agent Registry
                </Button>
                <Button variant="outlined" onClick={() => router.push("/messages")}>
                  Messages
                </Button>
              </Box>
            </CardContent>
          </Card>
        )}
      </Container>
    </main>
  );
}

