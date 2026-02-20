"use client";

import * as React from "react";
import Link from "next/link";
import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Container,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";

export default function HomePage() {
  return (
    <main>
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Box sx={{ mb: 3 }}>
          <Breadcrumbs aria-label="breadcrumb" sx={{ fontSize: 12 }}>
            <Typography color="text.secondary">Home</Typography>
          </Breadcrumbs>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Box sx={{ maxWidth: 900 }}>
            <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -0.6, mb: 1 }}>
              Agentic Trust Layer for Collective Impact
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              AI agents that earn the right to coordinate resources for communities — with every action verified on-chain.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              ETHDenver BUIDLathon 2026 — PROSPERIA Track (Collective Impact Labs × Agentic Trust)
            </Typography>
          </Box>

          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                Registration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Choose your onboarding flow.
              </Typography>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button
                  component={Link}
                  href="/onboarding/coordinator"
                  variant="contained"
                  sx={{ borderRadius: 999 }}
                >
                  Coordinator
                </Button>
                <Button
                  component={Link}
                  href="/onboarding/contributor"
                  variant="contained"
                  sx={{ borderRadius: 999 }}
                >
                  Contributor
                </Button>
                <Button
                  component={Link}
                  href="/onboarding/org-admin"
                  variant="contained"
                  sx={{ borderRadius: 999 }}
                >
                  Organization Admin
                </Button>
                <Button
                  component={Link}
                  href="/onboarding/funder"
                  variant="contained"
                  sx={{ borderRadius: 999 }}
                >
                  Funder / Grantmaker
                </Button>
              </Stack>
            </CardContent>
          </Card>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  What this is
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  A protocol where agents operate on behalf of organizations and contributors within trust constraints that
                  expand as they prove reliable — so coalitions can match needs to capacity in minutes, not weeks.
                </Typography>
              </CardContent>
            </Card>

            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  Architecture (at a glance)
                </Typography>
                <List dense sx={{ py: 0 }}>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText
                      primary="ERC-8004 Agent Identity"
                      secondary="On-chain agent identity + capabilities and affiliation."
                    />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText
                      primary="ERC-4337 Scoped Wallets"
                      secondary="Session keys enforce spend + authority bounds on-chain."
                    />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText
                      primary="EAS Attestations"
                      secondary="Portable, verifiable trust trail for engagements and outcomes."
                    />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText
                      primary="Progressive Trust"
                      secondary="Agents earn expanded bounds through verified performance."
                    />
                  </ListItem>
                </List>
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Container>
    </main>
  );
}

