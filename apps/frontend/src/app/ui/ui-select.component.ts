import { Component, ElementRef, forwardRef, inject, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';

export interface UiOption {
  value: string;
  label: string;
}

@Component({
  selector: 'ui-select',
  standalone: true,
  templateUrl: './ui-select.component.html',
  styleUrl: './ui-select.component.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiSelectComponent), multi: true }],
  host: { '(document:click)': 'onDocClick($event)', '(document:keydown.escape)': 'close()' },
})
export class UiSelectComponent implements ControlValueAccessor {
  readonly options = input<UiOption[]>([]);
  readonly placeholder = input('Select…');

  readonly value = signal<string | null>(null);
  readonly open = signal(false);
  readonly disabled = signal(false);

  private readonly el = inject(ElementRef<HTMLElement>);
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  selectedLabel(): string | null {
    const v = this.value();
    return this.options().find((o) => o.value === v)?.label ?? null;
  }

  toggle(): void {
    if (this.disabled()) return;
    this.open.update((o) => !o);
  }

  pick(opt: UiOption): void {
    this.value.set(opt.value);
    this.onChange(opt.value);
    this.onTouched();
    this.open.set(false);
  }

  close(): void {
    this.open.set(false);
  }

  onDocClick(ev: Event): void {
    if (this.open() && !this.el.nativeElement.contains(ev.target as Node)) this.close();
  }

  writeValue(v: string | null): void {
    this.value.set(v);
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }
}
