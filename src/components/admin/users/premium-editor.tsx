"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatDate,
  paymentMethodLabel,
  toDatetimeLocalValue,
} from "@/lib/admin-users-format";

import { postAdminAction } from "./post-admin-action";
import type { AdminUser } from "./types";

type PremiumPayment = {
  id: string;
  amount: number;
  currency: string;
  method: string;
  note: string | null;
  applied_until: string | null;
  created_at: string;
};

type PremiumUpdatePayload = {
  premiumUntil?: string | null;
  isPremium?: boolean;
  payment?: {
    amount: number;
    currency: string;
    method: string;
    note?: string;
  };
};

const PRESET_DAYS = [30, 90, 365] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function presetValue(days: number) {
  return toDatetimeLocalValue(
    new Date(Date.now() + days * DAY_MS).toISOString(),
  );
}

function usePremiumPayments(userId: string) {
  const [payments, setPayments] = useState<PremiumPayment[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/users/${userId}/payments`, { credentials: "include" })
      .then(async (response) => {
        const body = (await response.json()) as {
          ok?: boolean;
          payments?: PremiumPayment[];
        };
        if (active && response.ok && body.ok) setPayments(body.payments ?? []);
      })
      .catch(() => {
        if (active) setPayments([]);
      });
    return () => {
      active = false;
    };
  }, [userId, tick]);

  return { payments, reload: () => setTick((v) => v + 1) };
}

export function PremiumEditor({
  user,
  onUpdated,
}: {
  user: AdminUser;
  onUpdated: () => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [premiumUntil, setPremiumUntil] = useState(
    toDatetimeLocalValue(user.premium_until),
  );
  const [flagPremium, setFlagPremium] = useState(user.is_premium);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState("BYN");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentNote, setPaymentNote] = useState("");
  const { payments, reload: reloadPayments } = usePremiumPayments(user.id);

  const applyPreset = (days: number) => setPremiumUntil(presetValue(days));

  const submit = async (payload: PremiumUpdatePayload) => {
    setBusy(true);
    try {
      await postAdminAction(
        `/api/admin/users/${user.id}/premium`,
        { method: "POST", body: payload },
        "Could not update premium",
      );
      toast.success(
        payload.payment
          ? "Premium updated · payment registered"
          : "Premium updated",
      );
      if (payload.payment) {
        setPaymentAmount("");
        setPaymentNote("");
        reloadPayments();
      }
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update premium",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveWithOptionalPayment = () => {
    const amountNum = Number(paymentAmount);
    const payment =
      paymentAmount.trim().length > 0 &&
      Number.isFinite(amountNum) &&
      amountNum >= 0
        ? {
            amount: amountNum,
            currency: paymentCurrency.trim() || "BYN",
            method: paymentMethod,
            note: paymentNote.trim() || undefined,
          }
        : undefined;
    void submit({
      isPremium: flagPremium,
      premiumUntil: premiumUntil ? new Date(premiumUntil).toISOString() : null,
      payment,
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap gap-2">
        {PRESET_DAYS.map((days) => (
          <Button
            key={days}
            type="button"
            size="xs"
            variant="outline"
            className="rounded-full"
            onClick={() => applyPreset(days)}
            disabled={busy}
          >
            +{days}d
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${id}-until`} className="text-[11px]">
            Premium until
          </Label>
          <Input
            id={`${id}-until`}
            type="datetime-local"
            value={premiumUntil}
            onChange={(e) => setPremiumUntil(e.target.value)}
            className="mt-1 h-8 rounded-lg text-xs"
            disabled={busy}
          />
        </div>
        <label className="flex items-center gap-1.5 pb-1 text-xs">
          <input
            type="checkbox"
            checked={flagPremium}
            onChange={(e) => setFlagPremium(e.target.checked)}
            disabled={busy}
          />
          Manual flag
        </label>
      </div>

      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Payment history
        </p>
        {payments === null ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : payments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs"
              >
                <span className="font-semibold tabular-nums">
                  {payment.amount} {payment.currency}
                </span>
                <span className="text-muted-foreground">
                  {paymentMethodLabel(payment.method)}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(payment.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Register payment (optional)
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-24">
            <Label htmlFor={`${id}-amount`} className="text-[11px]">
              Amount
            </Label>
            <Input
              id={`${id}-amount`}
              type="number"
              min="0"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="mt-1 h-8 rounded-lg text-xs"
              disabled={busy}
            />
          </div>
          <div className="w-20">
            <Label htmlFor={`${id}-currency`} className="text-[11px]">
              Currency
            </Label>
            <Input
              id={`${id}-currency`}
              value={paymentCurrency}
              onChange={(e) => setPaymentCurrency(e.target.value)}
              className="mt-1 h-8 rounded-lg text-xs"
              disabled={busy}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Label htmlFor={`${id}-method`} className="text-[11px]">
              Method
            </Label>
            <select
              id={`${id}-method`}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              disabled={busy}
              className="mt-1 h-8 w-full rounded-lg border border-white/10 bg-transparent px-2 text-xs"
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <Input
          placeholder="Note (optional)"
          value={paymentNote}
          onChange={(e) => setPaymentNote(e.target.value)}
          className="h-8 rounded-lg text-xs"
          disabled={busy}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          className="rounded-full"
          onClick={saveWithOptionalPayment}
          disabled={busy}
        >
          Save
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="rounded-full"
          onClick={() => void submit({ premiumUntil: null })}
          disabled={busy}
        >
          Clear term
        </Button>
      </div>
    </div>
  );
}
