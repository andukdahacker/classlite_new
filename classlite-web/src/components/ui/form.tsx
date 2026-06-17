/*
 * CL-THEME-SWAP: shadcn base-nova registry does not ship a `form` component
 * (the registry entry returns an empty `files` array). This file is the
 * canonical shadcn form composition authored manually so AC1's RHF +
 * `zodResolver` story can compose against a stable surface. Pattern 2
 * reason: missing semantic slot in the upstream registry.
 */
import * as React from "react"
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

/*
 * CL-THEME-SWAP: Minimal Slot replacement. Base UI exposes per-primitive
 * Slot patterns via data-slot attributes rather than a generic `Slot`
 * component (no @radix-ui dep — see project-context.md shadcn rule).
 * Clones the single child and merges parent + child props so FormControl
 * can wire describedby / aria-invalid / id onto the underlying input.
 * React 19: refs are plain props, no forwardRef needed.
 *
 * Merge contract (parent = `rest` from FormControl, child = input element):
 *   - ARIA + id: parent wins. FormControl's error-driven `aria-invalid` /
 *     `aria-describedby` / `id` must reach the input even if the child
 *     hardcoded a default value. (Inverted from Radix Slot, which has
 *     parent-wins ARIA semantics — matches our intent here.)
 *   - className / style: composed via cn() so both layers apply.
 *   - Event handlers (on*): chained — parent runs first, then child.
 *   - Other props: child wins (consumer overrides intentionally).
 */
const ARIA_ID_KEYS = new Set([
  'id',
  'aria-invalid',
  'aria-describedby',
  'aria-labelledby',
])

function chainHandler<T extends (...args: never[]) => void>(
  parent: T | undefined,
  child: T | undefined,
): T | undefined {
  if (!parent) return child
  if (!child) return parent
  return ((...args: never[]) => {
    parent(...args)
    child(...args)
  }) as T
}

function Slot({
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  if (!React.isValidElement(children)) {
    if (import.meta.env.DEV) {
      console.warn(
        '[ui/form] <FormControl> expected a single React element child; ' +
          'received non-element children. ARIA wiring (id / aria-invalid / ' +
          'aria-describedby) is dropped.',
      )
    }
    return null
  }
  const child = children as React.ReactElement<Record<string, unknown>>
  const childProps = child.props
  const merged: Record<string, unknown> = { ...childProps }
  for (const key of Object.keys(rest)) {
    const parentValue = (rest as Record<string, unknown>)[key]
    if (parentValue === undefined) continue
    if (ARIA_ID_KEYS.has(key)) {
      merged[key] = parentValue
      continue
    }
    if (key === 'className') {
      merged.className = cn(parentValue as string, childProps.className as string | undefined)
      continue
    }
    if (key === 'style') {
      merged.style = { ...(parentValue as object), ...(childProps.style as object | undefined) }
      continue
    }
    if (key.startsWith('on') && typeof parentValue === 'function') {
      merged[key] = chainHandler(
        parentValue as (...args: never[]) => void,
        childProps[key] as ((...args: never[]) => void) | undefined,
      )
      continue
    }
    if (childProps[key] === undefined) merged[key] = parentValue
  }
  return React.cloneElement(child, merged)
}

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

type FormItemContextValue = { id: string }
const FormItemContext = React.createContext<FormItemContextValue | null>(null)

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  // Guards FIRST — surfacing the readable error here is better DX than
  // letting `useFormContext()` / `useFormState()` throw deeper RHF errors
  // when the consumer renders a Form* helper outside the provider tree.
  if (!fieldContext) {
    throw new Error("useFormField must be used inside a <FormField>")
  }
  if (!itemContext) {
    throw new Error("useFormField must be used inside a <FormItem>")
  }
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)
  const { id } = itemContext
  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId()
  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn("grid gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  )
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField()
  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()
  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={
        error
          ? `${formDescriptionId} ${formMessageId}`
          : formDescriptionId
      }
      aria-invalid={!!error}
      {...props}
    />
  )
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField()
  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function FormMessage({ className, children, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error.message ?? "") : children
  if (!body) return null
  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-sm text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  )
}

export {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  useFormField,
}
