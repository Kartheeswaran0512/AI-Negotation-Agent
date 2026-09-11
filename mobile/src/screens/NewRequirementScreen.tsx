/**
 * Creating a requirement, in the two steps the backend intends.
 *
 * POST /api/requirements/read turns free text into a PROPOSED requirement and
 * creates nothing; the buyer then confirms and POSTs the confirmed values. The
 * screen keeps that separation visible, because a misread requirement is not a
 * typo - it is an enquiry sent to real companies for the wrong product at the
 * wrong price.
 *
 * PRICE BASIS IS NEVER PRE-SELECTED. "5 pieces, budget 10,000" reads two ways
 * that differ by 5x. The server refuses to guess and returns null; this form
 * refuses to guess too, and blocks submission until the buyer says which.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ApiError } from '@/api/client';
import { useCreateRequirement, useReadRequirementText } from '@/api/queries';
import type { PriceBasis, ReadRequirementResult } from '@/api/types';
import { useSettings } from '@/config/settings';
import { rememberRequirementId } from '@/storage/localIndex';
import type { RootStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import { minorToAmount, parseAmountToMinor } from '@/utils/money';
import { describeField } from '@/utils/reasons';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  Row,
  ScreenScroll,
  SegmentedField,
  TextField,
} from '@/components/primitives';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const EXAMPLE = 'I need 100 wireless earbuds, target 600 per unit and a maximum of 700 per unit.';

interface FormState {
  product: string;
  quantity: string;
  unit: string;
  currency: string;
  targetPrice: string;
  maxPrice: string;
  priceBasis: PriceBasis | null;
}

const EMPTY_FORM: FormState = {
  product: '',
  quantity: '',
  unit: '',
  currency: 'INR',
  targetPrice: '',
  maxPrice: '',
  priceBasis: null,
};

export function NewRequirementScreen() {
  const navigation = useNavigation<Nav>();
  const { spacing, colors } = useTheme();
  const { userId } = useSettings();

  const [text, setText] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [unverified, setUnverified] = useState<string[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [buyerId, setBuyerId] = useState(userId);

  const read = useReadRequirementText();
  const create = useCreateRequirement();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /**
   * Fold a server reading into the form without discarding anything typed.
   *
   * `mutate` with callbacks, not `mutateAsync`: a rejected `mutateAsync` inside
   * a press handler becomes an unhandled promise rejection (a red box in dev,
   * a crash-reporter entry in production) even though the failure is already
   * being rendered from `read.isError`. `mutate` never throws.
   */
  const onRead = () => {
    read.mutate(text.trim(), { onSuccess: applyReading });
  };

  const applyReading = (result: ReadRequirementResult) => {
    setUnverified(result.unverified);
    setQuestion(result.question);

    const reading = result.reading;
    if (!reading) return;

    setForm((current) => ({
      product: reading.product ?? current.product,
      quantity: reading.quantity !== null ? String(reading.quantity) : current.quantity,
      unit: reading.unit ?? current.unit,
      currency: reading.currency ?? current.currency,
      // The reading carries MINOR units, unlike every presented response.
      targetPrice:
        reading.targetPriceMinor !== null
          ? minorToAmount(reading.targetPriceMinor)
          : current.targetPrice,
      maxPrice:
        reading.maxPriceMinor !== null ? minorToAmount(reading.maxPriceMinor) : current.maxPrice,
      priceBasis: reading.priceBasis ?? current.priceBasis,
    }));
  };

  const targetMinor = parseAmountToMinor(form.targetPrice);
  const maxMinor = parseAmountToMinor(form.maxPrice);
  const quantityValue = form.quantity.trim() === '' ? 0 : Number(form.quantity.trim());

  const errors: Partial<Record<keyof FormState | 'buyer_id', string>> = {};
  if (buyerId.trim() === '') errors.buyer_id = 'Required. Set your buyer id in Settings.';
  if (form.product.trim().length < 2) errors.product = 'Give the product a name.';
  if (form.targetPrice.trim() === '') errors.targetPrice = 'Required.';
  else if (targetMinor === null) errors.targetPrice = 'Use a plain amount such as 600 or 600.50.';
  if (form.maxPrice.trim() === '') errors.maxPrice = 'Required.';
  else if (maxMinor === null) errors.maxPrice = 'Use a plain amount such as 700 or 700.50.';
  if (targetMinor !== null && maxMinor !== null && maxMinor < targetMinor) {
    errors.maxPrice = 'The maximum cannot be below the target.';
  }
  if (form.priceBasis === null) errors.priceBasis = 'Choose one — the server will not guess.';
  if (form.priceBasis === 'total' && quantityValue <= 0) {
    errors.quantity = 'A total budget needs a quantity, or the per-unit price is ambiguous.';
  }
  if (form.quantity.trim() !== '' && !/^\d+$/.test(form.quantity.trim())) {
    errors.quantity = 'Whole numbers only.';
  }

  const serverFieldErrors = create.error instanceof ApiError ? create.error.fieldErrors() : {};
  const valid = Object.keys(errors).length === 0;

  const onCreate = () => {
    if (!valid || form.priceBasis === null) return;

    create.mutate(
      {
        buyer_id: buyerId.trim(),
        product: form.product.trim(),
        quantity: quantityValue,
        ...(form.unit.trim() ? { unit: form.unit.trim() } : {}),
        currency: form.currency.trim().toUpperCase() || 'INR',
        target_price: form.targetPrice.trim(),
        max_price: form.maxPrice.trim(),
        price_basis: form.priceBasis,
        ...(text.trim() ? { source_text: text.trim() } : {}),
      },
      {
        onSuccess: (requirement) => {
          // Remembering the id is what puts it on Home; a storage failure must
          // not stop the navigation, so it is not awaited before moving on.
          void rememberRequirementId(requirement.id).catch(() => undefined);
          navigation.replace('Requirement', { requirementId: String(requirement.id) });
        },
      },
    );
  };

  return (
    <ScreenScroll>
      {/* ---- Step 1: read free text -------------------------------------- */}
      <Card>
        <AppText variant="title">Describe what you need</AppText>
        <AppText variant="body" muted>
          Optional. The server reads your words into a draft and creates nothing — you confirm every
          value below.
        </AppText>

        <TextField
          testID="intake-text"
          label="In your own words"
          value={text}
          onChangeText={setText}
          placeholder={EXAMPLE}
          multiline
          autoCapitalize="sentences"
        />

        <Button
          label="Read this"
          onPress={onRead}
          loading={read.isPending}
          disabled={text.trim().length === 0}
        />

        {read.isError ? (
          <Banner tone="danger" title="Could not read that" message={read.error.message} />
        ) : null}

        {read.isSuccess ? (
          <Banner
            tone={read.data.ready ? 'success' : 'warning'}
            title={read.data.ready ? 'Read successfully' : 'Some details are missing'}
            message={
              question ??
              `Read by the ${read.data.source} interpreter. Nothing has been created yet.`
            }
          />
        ) : null}

        {unverified.length > 0 ? (
          <AppText variant="caption" muted>
            Could not verify: {unverified.map(describeField).join(', ')}. These were left for you to
            fill in rather than guessed.
          </AppText>
        ) : null}
      </Card>

      {/* ---- Step 2: confirm --------------------------------------------- */}
      <Card>
        <AppText variant="title">Confirm the requirement</AppText>
        <Divider />

        <View style={{ gap: spacing.lg }}>
          <TextField
            testID="field-buyer-id"
            label="Buyer id"
            value={buyerId}
            onChangeText={setBuyerId}
            keyboardType="numeric"
            error={errors.buyer_id ?? serverFieldErrors['buyer_id']}
            hint="Who owns this requirement. Only this id can accept an offer later."
          />

          <TextField
            testID="field-product"
            label="Product"
            value={form.product}
            onChangeText={(value) => set('product', value)}
            placeholder="wireless earbuds"
            autoCapitalize="sentences"
            error={errors.product ?? serverFieldErrors['product']}
          />

          <Row gap={spacing.md} align="flex-start">
            <View style={{ flex: 1 }}>
              <TextField
                testID="field-quantity"
                label="Quantity"
                value={form.quantity}
                onChangeText={(value) => set('quantity', value)}
                keyboardType="numeric"
                placeholder="100"
                error={errors.quantity ?? serverFieldErrors['quantity']}
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                testID="field-unit"
                label="Unit"
                value={form.unit}
                onChangeText={(value) => set('unit', value)}
                placeholder="pieces"
              />
            </View>
          </Row>

          <SegmentedField<PriceBasis>
            label="Are those prices per unit, or for the whole order?"
            value={form.priceBasis}
            onChange={(value) => set('priceBasis', value)}
            options={[
              { value: 'per_unit', label: 'Per unit' },
              { value: 'total', label: 'Whole order' },
            ]}
            error={errors.priceBasis ?? serverFieldErrors['price_basis']}
            hint="Never assumed. The two readings can differ by the whole order quantity."
          />

          <Row gap={spacing.md} align="flex-start">
            <View style={{ flex: 1 }}>
              <TextField
                testID="field-target"
                label="Target price"
                value={form.targetPrice}
                onChangeText={(value) => set('targetPrice', value)}
                keyboardType="decimal-pad"
                placeholder="600"
                error={errors.targetPrice ?? serverFieldErrors['target_price']}
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                testID="field-max"
                label="Maximum"
                value={form.maxPrice}
                onChangeText={(value) => set('maxPrice', value)}
                keyboardType="decimal-pad"
                placeholder="700"
                error={errors.maxPrice ?? serverFieldErrors['max_price']}
              />
            </View>
          </Row>

          <TextField
            testID="field-currency"
            label="Currency"
            value={form.currency}
            onChangeText={(value) => set('currency', value.toUpperCase())}
            placeholder="INR"
            hint="Three-letter code. Recorded, never converted."
          />
        </View>

        <Banner
          tone="info"
          title="Your maximum stays private"
          message="The agent never puts your ceiling in front of a supplier. The highest figure it will ever offer is the midpoint between your target and your maximum."
        />

        {create.isError ? (
          <Banner
            tone="danger"
            title="The server refused this requirement"
            message={create.error.message}
          />
        ) : null}

        <Button
          label="Create requirement"
          fullWidth
          onPress={onCreate}
          loading={create.isPending}
          disabled={!valid}
        />

        {!valid ? (
          <AppText variant="caption" color={colors.textMuted} align="center">
            Fill in the highlighted fields to continue.
          </AppText>
        ) : null}
      </Card>
    </ScreenScroll>
  );
}
