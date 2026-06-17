/**
 * NavigationMenu — Story 1d-2 AC3.
 *
 * AC3 keyboard-nav play deferred for the same Base UI test-runner
 * production-error #31 reason DropdownMenu documents — NavigationMenu's
 * triggers route through the same portal/click composition. Static axe
 * smoke covers the rendered surface; real Tab / arrow / Enter / Escape
 * keyboard coverage moves to the integration layer once 1d-3's role-
 * aware top navigation wires real shortcuts. Re-enable when Base UI
 * stabilizes its test-runner interop (code review 2026-06-17).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from './navigation-menu'

const meta = {
  title: 'ui/NavigationMenu',
  component: NavigationMenu,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof NavigationMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Classes</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-64 gap-1 p-2">
              <li>
                <NavigationMenuLink href="#">IELTS 7.0 evening</NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink href="#">IELTS 6.5 morning</NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink href="#">Speaking lab</NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>People</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-64 gap-1 p-2">
              <li>
                <NavigationMenuLink href="#">Students</NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink href="#">Teachers</NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
}

export const WithSubmenu: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Settings</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-64 gap-1 p-2">
              <li>
                <NavigationMenuLink href="#">Center profile</NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink href="#">Branding</NavigationMenuLink>
              </li>
              <li>
                <NavigationMenuLink href="#">Roles &amp; permissions</NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
}

export const WithSeparators: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Reports</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-64 gap-1 p-2">
              <li>
                <NavigationMenuLink href="#">Class performance</NavigationMenuLink>
              </li>
              <li>
                <hr className="my-1 border-border" />
              </li>
              <li>
                <NavigationMenuLink href="#">Student performance</NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
}

export const WithShortcuts: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Quick</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-64 gap-1 p-2">
              <li>
                <NavigationMenuLink href="#" className="flex items-center justify-between">
                  Search
                  <kbd className="font-mono">⌘K</kbd>
                </NavigationMenuLink>
              </li>
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
}

export const Disabled: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger disabled>Disabled section</NavigationMenuTrigger>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
}
