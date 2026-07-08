export interface BulkController {
  cancelled: boolean;
}

export interface BulkFailure {
  id: string;
  label: string;
  error: string;
}

export interface BulkProgress {
  action: string;
  index: number;
  total: number;
  itemLabel: string;
  creditsSpent: number;
  failures: BulkFailure[];
  cancelling?: boolean;
}

export interface BulkResult<TResult> {
  total: number;
  done: number;
  creditsSpent: number;
  failures: BulkFailure[];
  results: TResult[];
  cancelled: boolean;
  stoppedReason: string | null;
}

export interface BulkItem<T> {
  id: string;
  label: string;
  value: T;
}

export async function runBulkOperation<TItem, TResult>({
  action,
  items,
  controller,
  runItem,
  getCredits,
  getErrorMessage,
  onProgress,
  onItemComplete,
  shouldStopBeforeItem,
}: {
  action: string;
  items: Array<BulkItem<TItem>>;
  controller: BulkController;
  runItem: (item: TItem, index: number) => Promise<TResult>;
  getCredits: (result: TResult) => number;
  getErrorMessage: (error: unknown) => string;
  onProgress?: (progress: BulkProgress) => void;
  onItemComplete?: (result: TResult, index: number) => Promise<void> | void;
  shouldStopBeforeItem?: (context: { item: BulkItem<TItem>; index: number; creditsSpent: number }) => string | null;
}): Promise<BulkResult<TResult>> {
  const results: TResult[] = [];
  const failures: BulkFailure[] = [];
  let creditsSpent = 0;
  let stoppedReason: string | null = null;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (controller.cancelled) break;

    stoppedReason = shouldStopBeforeItem?.({ item, index, creditsSpent }) ?? null;
    if (stoppedReason) break;

    onProgress?.({
      action,
      index: index + 1,
      total: items.length,
      itemLabel: item.label,
      creditsSpent,
      failures,
    });

    try {
      const result = await runItem(item.value, index);
      results.push(result);
      creditsSpent += Math.max(0, Math.round(getCredits(result)));
      await onItemComplete?.(result, index);
    } catch (error) {
      failures.push({
        id: item.id,
        label: item.label,
        error: getErrorMessage(error),
      });
    }

    onProgress?.({
      action,
      index: index + 1,
      total: items.length,
      itemLabel: item.label,
      creditsSpent,
      failures,
      cancelling: controller.cancelled,
    });
  }

  return {
    total: items.length,
    done: results.length,
    creditsSpent,
    failures,
    results,
    cancelled: controller.cancelled,
    stoppedReason,
  };
}
