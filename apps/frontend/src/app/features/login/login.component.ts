import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errMsg } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly industries = [
    {
      word: 'Supermarkets',
      line: 'Scan, sell and restock — even when the internet is down.',
      tag: 'One till shift with Mizan',
      accent: '#43e6a0', c2: '#00c2ff', deep: '#07251d',
      stops: [
        { i: '🛒', t: 'Scan & sell', d: '40 items a minute, queue gone' },
        { i: '📦', t: 'Stock watches itself', d: 'Low shelves flag before they empty' },
        { i: '📴', t: 'Internet down?', d: 'The till keeps selling, syncs later' },
        { i: '📊', t: 'Day closed', d: 'Profit, top sellers, cash — one screen' },
      ],
    },
    {
      word: 'Restaurants',
      line: 'Orders, tables and kitchen — perfectly in sync.',
      tag: 'Dinner service with Mizan',
      accent: '#ffb454', c2: '#ff5d73', deep: '#2a1206',
      stops: [
        { i: '🍽️', t: 'Table 12 orders', d: 'Order fires straight to the kitchen' },
        { i: '👨‍🍳', t: 'Kitchen queue', d: 'Every dish timed, nothing forgotten' },
        { i: '🧾', t: 'Bill splits in taps', d: 'Three friends, three payments, done' },
        { i: '🔥', t: 'Service ends', d: 'Tonight’s best sellers revealed' },
      ],
    },
    {
      word: 'Pharmacies',
      line: 'Every batch tracked. Every expiry caught.',
      tag: 'A dispensing day with Mizan',
      accent: '#5bd0ff', c2: '#4ade80', deep: '#06222e',
      stops: [
        { i: '💊', t: 'Dispense safely', d: 'Prescription and batch verified' },
        { i: '🏷️', t: 'Every pack traced', d: 'From batch to customer, tracked' },
        { i: '⏰', t: 'Expiry caught early', d: 'Flagged 90 days before the date' },
        { i: '📋', t: 'Audit ready', d: 'Records kept, compliance done' },
      ],
    },
    {
      word: 'Boutiques',
      line: 'Variants, seasons and loyal customers — handled.',
      tag: 'A season with Mizan',
      accent: '#ff7ab8', c2: '#b388ff', deep: '#2a0a24',
      stops: [
        { i: '👗', t: 'Every size counted', d: 'Colours and variants, always live' },
        { i: '✨', t: 'New season lands', d: 'Old stock marks itself down' },
        { i: '💝', t: 'Regulars remembered', d: 'Points and perks, automatic' },
        { i: '↩️', t: 'Easy returns', d: 'Exchanged in under a minute' },
      ],
    },
    {
      word: 'Rentals',
      line: 'Book it out. Track it. Get it back on time.',
      tag: 'One booking with Mizan',
      accent: '#9d8cff', c2: '#38e8ff', deep: '#130a33',
      stops: [
        { i: '🔑', t: 'Booked out', d: 'Calendar fills, clashes blocked' },
        { i: '💰', t: 'Deposit held', d: 'Taken and tracked automatically' },
        { i: '🚗', t: 'On the road', d: 'Who has what, until when' },
        { i: '⏱️', t: 'Due back', d: 'Late fees worked out for you' },
      ],
    },
    {
      word: 'Hotels',
      line: 'Rooms, check-ins and housekeeping on one screen.',
      tag: 'One night with Mizan',
      accent: '#ffd166', c2: '#ff8f6b', deep: '#241203',
      stops: [
        { i: '🛎️', t: 'Check-in, 30 sec', d: 'Guest in, key out, no paperwork' },
        { i: '🛏️', t: 'Room 204 flips', d: 'Housekeeping pinged when it’s free' },
        { i: '🍳', t: 'Breakfast on room', d: 'Charges land on the folio' },
        { i: '🌙', t: 'Night audit', d: 'Books balance while you sleep' },
      ],
    },
  ];

  readonly ind = signal(0);
  private timer = setInterval(() => this.advance(), 5000);

  go(i: number): void {
    this.ind.set(i);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.advance(), 5000);
  }

  private advance(): void {
    this.ind.set((this.ind() + 1) % this.industries.length);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  readonly mode = signal<'tenant' | 'platform'>('tenant');
  readonly busy = signal(false);
  readonly error = signal('');

  slug = this.auth.tenantSlug ?? '';
  email = '';
  password = '';

  async submit(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'tenant') {
        await this.auth.loginTenant(this.slug.trim(), this.email.trim(), this.password);
        await this.router.navigate(['/pos']);
      } else {
        await this.auth.loginPlatform(this.email.trim(), this.password);
        await this.router.navigate(['/platform']);
      }
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
