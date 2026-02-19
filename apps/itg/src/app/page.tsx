"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Container,
  Link as MUILink,
  List,
  ListItem,
  ListItemText,
  Typography
} from "@mui/material";
import { useConnection } from "../components/connection-context";
import { sepolia } from "viem/chains";

export default function HomePage() {
  const router = useRouter();
  const { user } = useConnection();

  // NOTE: We used to auto-redirect connected users with existing orgs to /dashboard.
  // This caused unexpected navigation away from other routes (e.g. /messages),
  // so the automatic redirect has been disabled. Users can navigate via the header.
  return (
    <main>
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Box sx={{ mb: 3 }}>
          <Breadcrumbs aria-label="breadcrumb" sx={{ fontSize: 12 }}>
            <Typography color="text.secondary">Home</Typography>
          </Breadcrumbs>
        </Box>

        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 4,
            alignItems: { xs: "stretch", md: "flex-start" }
          }}
        >


        </Box>
      </Container>
    </main>
  );
}

